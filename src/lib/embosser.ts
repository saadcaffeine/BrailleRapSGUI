// Live connection to the embosser through ESP3D (MarlinBraille2 + ESP3DLib on the TinyBee).
//
// Keeps one websocket open (Marlin output arrives as binary frames), polls Marlin
// with M119 / M27 without ever having more than one query in flight, checks the SD
// card through ESP3D, and turns everything Marlin says into a status object the UI
// can show as LEDs. Also runs print jobs (upload to SD -> M23/M24 -> watch).
//
// Things it recognises in Marlin's output:
//   x_min: open|TRIGGERED, y_min: ...        M119 endstops (Y = paper sensor)
//   SD printing byte a/b, Not SD printing    M27 job progress
//   echo:busy: processing                   Marlin alive but busy (homing / loading paper)
//   Error:Paper not loaded                  paper sensor never triggered (MarlinBraille2 xl-sg)
//   Printer halted / kill() called          firmware halted, needs a restart
//   Done printing file                      SD job finished
//   start / Marlin x.y                      firmware (re)booted

import { getWebsocketPort, sendCommand, uploadToSd, SD_FILENAME } from './esp3d'

export type LinkState = 'connecting' | 'ok' | 'busy' | 'lost' | 'halted'
export type SdState = 'ok' | 'missing' | 'unknown'
export type EndstopState = 'open' | 'triggered' | 'unknown'

// where the running job is, from the M118 BR: markers in the G-code
export type JobStage = 'homing' | 'paper' | 'printing' | 'eject' | 'end'

export interface IEmbosserStatus {
  link: LinkState
  stage?: JobStage
  dot: number
  dots: number
  sd: SdState
  xEndstop: EndstopState
  paperSensor: EndstopState
  sdPrinting: boolean
  progress: number
  halted: boolean
  haltReason?: string
  lastError?: string
}

export type JobPhase =
  | 'idle' | 'connecting' | 'uploading' | 'starting' | 'homing' | 'loading paper'
  | 'printing' | 'ejecting' | 'cancelling' | 'done' | 'cancelled' | 'failed' | 'no contact' | 'stopped'

export interface IJobState {
  phase: JobPhase
  progress: number       // overall (uploading) or print progress 0-100
  dot?: number
  dots?: number
  homeY?: boolean        // false when the job skips paper loading
  failedAt?: JobStage
  message?: string
}

const stagePhase = (stage?: JobStage): JobPhase | undefined =>
  stage === 'homing' ? 'homing' : stage === 'paper' ? 'loading paper'
    : stage === 'printing' ? 'printing' : stage === 'eject' || stage === 'end' ? 'ejecting' : undefined

export type JobErrorKind = 'paper' | 'halted' | 'lost' | 'busy' | 'no-card' | 'upload' | 'not-responding' | 'other'

export class JobError extends Error {
  kind: JobErrorKind
  constructor(kind: JobErrorKind, message: string) {
    super(message)
    this.kind = kind
  }
}

type Listener = (s: IEmbosserStatus) => void
type LineListener = (line: string) => void

const POLL_MS = 2000
const QUERY_TIMEOUT_MS = 5000
const SILENT_LOST_MS = 9000      // no output at all for this long -> link lost
const BUSY_WINDOW_MS = 5000      // a "busy" line within this window -> link busy
const SD_CHECK_EVERY = 8         // idle poll ticks between SD card checks

const RE_ENDSTOP = /^(x_min|y_min):\s*(open|TRIGGERED)/i
const RE_SD_PRINTING = /SD printing byte (\d+)\/(\d+)/i
const RE_NOT_SD_PRINTING = /Not SD printing/i
const RE_STATUS_REPLY = /SD printing byte|Not SD printing|x_min:|y_min:/i

export class Embosser {
  host?: string
  status: IEmbosserStatus = {
    link: 'connecting', sd: 'unknown', xEndstop: 'unknown', paperSensor: 'unknown',
    sdPrinting: false, progress: 0, halted: false, dot: 0, dots: 0,
  }
  private ws?: WebSocket
  private wsPort?: number
  private buffer = ''
  private lastSeen = 0
  private lastBusy = 0
  private pending?: { match: RegExp; resolve: (l: string) => void; reject: (e: Error) => void; timer: number; sentAt: number }
  private pollTimer?: number
  // last M27 answer and when that M27 was sent (to tell a fresh "Not SD printing" from a stale one)
  lastM27?: { printing: boolean; sentAt: number }
  lastDoneAt = 0
  stoppedAt = 0
  stageAt = 0
  private tick = 0
  private listeners: Listener[] = []
  private lineListeners: LineListener[] = []
  private stopped = true

  start(host?: string) {
    this.host = host
    if (!this.stopped) return
    this.stopped = false
    void this.connect()
    this.pollTimer = window.setInterval(() => this.poll(), POLL_MS)
  }

  stop() {
    this.stopped = true
    window.clearInterval(this.pollTimer)
    this.ws?.close()
  }

  subscribe(fn: Listener) {
    this.listeners.push(fn)
    fn(this.status)
    return () => { this.listeners = this.listeners.filter((l) => l !== fn) }
  }

  onLine(fn: LineListener) {
    this.lineListeners.push(fn)
    return () => { this.lineListeners = this.lineListeners.filter((l) => l !== fn) }
  }

  private update(patch: Partial<IEmbosserStatus>) {
    this.status = { ...this.status, ...patch }
    this.listeners.forEach((l) => l(this.status))
  }

  private async connect() {
    if (this.stopped) return
    try {
      if (!this.wsPort) this.wsPort = await getWebsocketPort(this.host)
      const hostname = this.host ? this.host.split(':')[0] : window.location.hostname
      const ws = new WebSocket(`ws://${hostname}:${this.wsPort}/`, ['arduino'])
      ws.binaryType = 'arraybuffer'
      ws.onmessage = (ev: MessageEvent) => this.onMessage(ev)
      ws.onclose = () => {
        if (this.ws === ws) this.ws = undefined
        if (!this.status.halted) this.update({ link: 'lost' })
        if (!this.stopped) window.setTimeout(() => void this.connect(), 3000)
      }
      ws.onopen = () => { this.lastSeen = Date.now(); void this.poll() }
      this.ws = ws
    } catch (e) {
      this.update({ link: 'lost' })
      if (!this.stopped) window.setTimeout(() => void this.connect(), 3000)
    }
  }

  private onMessage(ev: MessageEvent) {
    if (typeof ev.data === 'string') return // ESP3D CURRENT_ID / ACTIVE_ID / PING
    this.buffer += new TextDecoder().decode(ev.data as ArrayBuffer)
    const lines = this.buffer.split(/\r?\n/)
    this.buffer = lines.pop() || ''
    for (const raw of lines) {
      const line = raw.trim()
      if (line) this.handleLine(line)
    }
  }

  private handleLine(line: string) {
    const now = Date.now()
    this.lastSeen = now
    const patch: Partial<IEmbosserStatus> = {}

    const es = RE_ENDSTOP.exec(line)
    if (es) {
      const v: EndstopState = es[2].toLowerCase() === 'open' ? 'open' : 'triggered'
      if (es[1].toLowerCase() === 'x_min') patch.xEndstop = v
      else patch.paperSensor = v
    }
    const sp = RE_SD_PRINTING.exec(line)
    if (sp) {
      const total = parseInt(sp[2], 10)
      patch.sdPrinting = true
      patch.progress = total > 0 ? (parseInt(sp[1], 10) / total) * 100 : 0
      patch.sd = 'ok'
    } else if (RE_NOT_SD_PRINTING.test(line)) {
      patch.sdPrinting = false
    }
    if (/busy:/i.test(line)) this.lastBusy = now
    const mk = /BR:(HOMING|PAPER|PRINT|DOT|EJECT|END)(?:\s+(\d+)\/(\d+))?/.exec(line)
    if (mk) {
      this.stageAt = now
      const kind = mk[1]
      if (kind === 'HOMING') patch.stage = 'homing'
      else if (kind === 'PAPER') patch.stage = 'paper'
      else if (kind === 'EJECT') patch.stage = 'eject'
      else if (kind === 'END') patch.stage = 'end'
      else {
        patch.stage = 'printing'
        patch.dot = parseInt(mk[2] || '0', 10)
        patch.dots = parseInt(mk[3] || '0', 10)
      }
    }
    if (/SD card ok/i.test(line)) patch.sd = 'ok'
    if (/SD init fail|No media|No SD card/i.test(line)) patch.sd = 'missing'
    if (/Done printing file/i.test(line)) { patch.sdPrinting = false; patch.progress = 100; this.lastDoneAt = now }
    if (/Paper not loaded/i.test(line)) { patch.lastError = 'Paper not loaded'; patch.sdPrinting = false }
    else if (/Printer halted|kill\(\) called/i.test(line)) {
      patch.halted = true
      patch.haltReason = this.status.lastError || 'The firmware stopped (for example a homing failure).'
      patch.sdPrinting = false
    } else if (/^Error:/i.test(line) || /Bad . Endstop/i.test(line)) {
      patch.lastError = line.replace(/^Error:/i, '').trim()
    }
    if (/^start$|^Marlin \d/i.test(line)) {
      // firmware rebooted
      Object.assign(patch, { halted: false, haltReason: undefined, lastError: undefined, sdPrinting: false })
    }

    patch.link = this.computeLink(patch.halted ?? this.status.halted)
    this.update(patch)

    if (this.pending && this.pending.match.test(line)) {
      const p = this.pending
      this.pending = undefined
      window.clearTimeout(p.timer)
      if (RE_SD_PRINTING.test(line) || RE_NOT_SD_PRINTING.test(line)) {
        this.lastM27 = { printing: RE_SD_PRINTING.test(line), sentAt: p.sentAt }
      }
      p.resolve(line)
    }
    this.lineListeners.forEach((l) => l(line))
  }

  private computeLink(halted: boolean): LinkState {
    if (halted) return 'halted'
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return this.lastSeen ? 'lost' : 'connecting'
    const now = Date.now()
    const waiting = this.pending && now - this.pending.sentAt > 3000
    if (waiting && now - this.lastBusy < BUSY_WINDOW_MS) return 'busy'
    if (now - this.lastSeen > SILENT_LOST_MS) return 'lost'
    if (now - this.lastBusy < BUSY_WINDOW_MS) return 'busy'
    return 'ok'
  }

  // One query in flight at a time, so polling never floods Marlin's command queue
  query(cmd: string, match: RegExp = RE_STATUS_REPLY, timeoutMs = QUERY_TIMEOUT_MS): Promise<string> {
    if (this.pending) return Promise.reject(new Error('busy'))
    return new Promise<string>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending = undefined
        reject(new Error(`No reply to ${cmd}`))
      }, timeoutMs)
      this.pending = { match, resolve, reject, timer, sentAt: Date.now() }
      sendCommand(cmd, this.host).catch((e: Error) => {
        window.clearTimeout(timer)
        this.pending = undefined
        reject(e)
      })
    })
  }

  command(cmd: string) {
    return sendCommand(cmd, this.host)
  }

  private async poll() {
    if (this.stopped) return
    const link = this.computeLink(this.status.halted)
    if (link !== this.status.link) this.update({ link })
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || this.status.halted || this.pending) return
    this.tick++
    const idle = !this.status.sdPrinting && !this.jobActive
    try {
      if (idle && this.tick % SD_CHECK_EVERY === 1) await this.checkSd()
      if (idle && this.tick % 2 === 0) await this.query('M119', /y_min:/i)
      else await this.query('M27', /SD printing byte|Not SD printing/i)
    } catch {
      // timeouts show up through computeLink(); nothing else to do here
    }
  }

  // ESP3D answers {"status":"Ok"} or {"status":"No SD Card"} without listing files
  async checkSd() {
    try {
      const base = this.host && this.host !== window.location.host ? `http://${this.host}` : ''
      const res = await fetch(`${base}/upload?path=/&dontlist=yes`)
      const text = await res.text()
      if (/no sd card/i.test(text)) this.update({ sd: 'missing' })
      else if (/"status"\s*:\s*"ok"/i.test(text)) this.update({ sd: 'ok' })
      else this.update({ sd: 'unknown' }) // firmware without SD support in ESP3D
    } catch {
      // leave as is
    }
  }

  // ESP3D restarts the whole ESP32, which also restarts Marlin (needed after a halt)
  async restart() {
    this.stoppedAt = Date.now()
    try {
      await sendCommand('[ESP444]RESTART', this.host)
    } catch {
      // the connection usually drops as it restarts
    }
    this.update({ link: 'connecting', halted: false, haltReason: undefined, lastError: undefined, sdPrinting: false })
    this.ws?.close()
  }

  private jobActive = false

  // ---- print job -------------------------------------------------------------

  async print(gcode: string | undefined, onState: (s: IJobState) => void): Promise<{ done: Promise<void>; cancel: () => Promise<void> }> {
    onState({ phase: 'connecting', progress: 0 })
    await this.waitForLink(8000)
    if (this.status.halted) throw new JobError('halted', 'The embosser has stopped and needs a restart.')

    // fresh status before touching the SD card
    const st = await this.queryWithRetry('M27', /SD printing byte|Not SD printing/i)
    if (RE_SD_PRINTING.test(st)) throw new JobError('busy', 'The embosser is already printing. Wait for it to finish or cancel it.')

    this.jobActive = true
    this.update({ lastError: undefined, progress: 0, stage: undefined, dot: 0, dots: 0 })
    try {
      if (gcode !== undefined) {
        onState({ phase: 'uploading', progress: 0 })
        try {
          await uploadToSd(gcode, this.host, (pct) => onState({ phase: 'uploading', progress: pct }))
        } catch (e) {
          const msg = (e as Error).message
          throw new JobError(/no sd card/i.test(msg) ? 'no-card' : 'upload', msg)
        }
      }
      onState({ phase: 'starting', progress: 0 })
      await this.command(`M23 ${SD_FILENAME}`)
      await this.command('M24')
    } catch (e) {
      this.jobActive = false
      throw e
    }
    return this.watchJob(onState)
  }

  // Follow a job that is running on the SD card (also used to re-attach after a page reload)
  watchJob(onState: (s: IJobState) => void) {
    this.jobActive = true
    let cancelled = false
    const startedAt = Date.now()
    let seenPrinting = this.status.sdPrinting
    let lostSince = 0

    const done = new Promise<void>((resolve, reject) => {
      let finished = false
      let unsubscribe = () => {}
      let ticker = 0
      const finish = (fn: () => void) => {
        if (finished) return
        finished = true
        unsubscribe()
        window.clearInterval(ticker)
        this.jobActive = false
        fn()
      }
      const handle = (s: IEmbosserStatus) => {
        if (finished) return
        const stageNow = this.stageAt > startedAt ? s.stage : undefined
        if (this.stoppedAt > startedAt) {
          finish(() => {
            onState({ phase: 'stopped', progress: s.dots ? (s.dot / s.dots) * 100 : 0, dot: s.dot, dots: s.dots, failedAt: stageNow, message: 'restarting the embosser…' })
            resolve()
          })
          return
        }
        if (s.lastError === 'Paper not loaded') {
          finish(() => {
            onState({ phase: 'failed', progress: 0, failedAt: 'paper', message: 'paper did not load' })
            reject(new JobError('paper', 'Paper did not load. Put a sheet in the feeder (against the paper sensor), then press Retry.'))
          })
          return
        }
        if (s.halted) {
          finish(() => {
            onState({ phase: 'failed', progress: 0, failedAt: stageNow || 'homing', message: 'embosser stopped' })
            reject(new JobError('halted', `The embosser stopped: ${s.haltReason || 'firmware halted'}. Restart it, then press Retry.`))
          })
          return
        }
        if (s.link === 'lost') {
          lostSince = lostSince || Date.now()
          onState({ phase: 'no contact', progress: s.dots ? (s.dot / s.dots) * 100 : s.progress, dot: s.dot, dots: s.dots, message: 'No contact with the embosser. The print continues from the SD card if it is still running.' })
          if (Date.now() - lostSince > 60000) {
            finish(() => reject(new JobError('lost', 'Lost contact with the embosser for over a minute. If it is still embossing, this page will show it again when contact returns.')))
          }
          return
        }
        lostSince = 0
        const m27 = this.lastM27
        const freshIdle = m27 !== undefined && !m27.printing && m27.sentAt > startedAt + 300
        const jobOver = (seenPrinting && !s.sdPrinting) || freshIdle || this.lastDoneAt > startedAt
        const printPct = s.dots ? (s.dot / s.dots) * 100 : 0
        const base = { dot: s.dot, dots: s.dots }
        if (s.sdPrinting && !jobOver) {
          seenPrinting = true
          const phase = cancelled ? 'cancelling' : stagePhase(stageNow) || (s.progress < 1 ? 'homing' : 'printing')
          onState({ phase, progress: stageNow ? printPct : s.progress, ...base })
        } else if (jobOver) {
          finish(() => {
            onState({ phase: cancelled ? 'cancelled' : 'done', progress: cancelled ? printPct : 100, ...base, failedAt: cancelled ? stageNow : undefined })
            resolve()
          })
        } else if (s.link === 'busy' || stageNow) {
          // M24 accepted; Marlin is homing / feeding paper and not answering M27 yet
          onState({ phase: cancelled ? 'cancelling' : stagePhase(stageNow) || 'homing', progress: printPct, ...base })
        }
      }
      unsubscribe = this.subscribe(handle)
      // re-check periodically: the status only changes when Marlin says something
      ticker = window.setInterval(() => handle(this.status), POLL_MS)
    })

    const cancel = async () => {
      cancelled = true
      onState({ phase: 'cancelling', progress: this.status.progress, message: 'Stopping after the current move…' })
      await this.command('M524')
    }
    return { done, cancel }
  }

  private async waitForLink(timeoutMs: number) {
    const t0 = Date.now()
    while (Date.now() - t0 < timeoutMs) {
      if (this.status.halted || this.status.link === 'ok' || this.status.link === 'busy') return
      await new Promise((r) => window.setTimeout(r, 250))
    }
    throw new JobError('not-responding', 'The embosser is not responding. Check that this device is on the embosser WiFi and the embosser is powered.')
  }

  private async queryWithRetry(cmd: string, match: RegExp) {
    for (let i = 0; i < 4; i++) {
      try {
        return await this.query(cmd, match)
      } catch (e) {
        if ((e as Error).message !== 'busy') break
        await new Promise((r) => window.setTimeout(r, 600))
      }
    }
    throw new JobError('not-responding', 'The embosser did not answer. It may be busy or stopped.')
  }
}

export const embosser = new Embosser()
