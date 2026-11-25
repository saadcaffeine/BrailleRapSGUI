// Print through the ESP3D web server running on the controller's ESP32
// (MarlinBraille2 built with ESP3D_WIFISUPPORT + SDSUPPORT).
//
// Flow:
//   1. check the machine is idle            GET /command?commandText=M27
//   2. upload the G-code to the SD card     POST /upload (multipart, ESP3D "direct SD")
//   3. select + start the file              M23 /braille.gco, M24
//   4. poll progress                        M27 -> "SD printing byte a/b" | "Not SD printing"
//   5. optional cancel                      M524
//
// Marlin's replies to commands sent through /command come back on the ESP3D
// websocket (port 81 by default) as binary frames; text frames are ESP3D's
// own CURRENT_ID / ACTIVE_ID / PING messages.
//
// Because the job runs from the SD card, it carries on if the phone sleeps
// or the browser is closed once printing has started.

import { ISerialState } from './serial'

export const SD_FILENAME = '/braille.gco' // must stay 8.3: ESP3D rewrites names with makepath83

export interface IEsp3dOptions {
  host?: string                // defaults to the host that served this page
  onState: (state: ISerialState) => void
  onLog?: (line: string) => void
  pollMs?: number
}

export interface IEsp3dJob {
  done: Promise<void>
  cancel: () => Promise<void>
}

const baseUrl = (host?: string) => {
  if (!host || host === window.location.host) return ''
  return `http://${host}`
}

const hostname = (host?: string) => (host ? host.split(':')[0] : window.location.hostname)

export const sendCommand = async (cmd: string, host?: string): Promise<string> => {
  const res = await fetch(`${baseUrl(host)}/command?commandText=${encodeURIComponent(cmd)}`)
  if (!res.ok) throw new Error(`Command "${cmd}" failed: HTTP ${res.status}`)
  return res.text()
}

// [ESP800] reports, among other things, "webcommunication: Sync: <port>"
export const getWebsocketPort = async (host?: string): Promise<number> => {
  try {
    const info = await sendCommand('[ESP800]', host)
    const m = /Sync:\s*(\d+)/i.exec(info)
    if (m) return parseInt(m[1], 10)
  } catch (e) {
    console.warn('ESP800 failed, assuming websocket port 81', e)
  }
  return 81
}

// Line-buffered reader for Marlin output arriving over the ESP3D websocket
class MarlinSocket {
  private ws?: WebSocket
  private buffer = ''
  private listeners: ((line: string) => void)[] = []

  async open(host: string | undefined, port: number) {
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://${hostname(host)}:${port}/`, ['arduino'])
      ws.binaryType = 'arraybuffer'
      const timer = setTimeout(() => reject(new Error('Websocket connection timed out')), 5000)
      ws.onopen = () => {
        clearTimeout(timer)
        resolve()
      }
      ws.onerror = () => {
        clearTimeout(timer)
        reject(new Error('Could not open the ESP3D websocket'))
      }
      ws.onmessage = (ev: MessageEvent) => this.onMessage(ev)
      this.ws = ws
    })
  }

  private onMessage(ev: MessageEvent) {
    if (typeof ev.data === 'string') return // CURRENT_ID / ACTIVE_ID / PING
    this.buffer += new TextDecoder().decode(ev.data as ArrayBuffer)
    const lines = this.buffer.split(/\r?\n/)
    this.buffer = lines.pop() || ''
    for (const line of lines) {
      if (line.trim().length === 0) continue
      this.listeners.forEach((l) => l(line.trim()))
    }
  }

  onLine(listener: (line: string) => void) {
    this.listeners.push(listener)
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener)
    }
  }

  // Send a command and resolve with the first output line that matches
  async query(cmd: string, match: RegExp, host?: string, timeoutMs = 4000): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const off = this.onLine((line) => {
        if (match.test(line)) {
          clearTimeout(timer)
          off()
          resolve(line)
        }
      })
      const timer = setTimeout(() => {
        off()
        reject(new Error(`No reply to ${cmd}`))
      }, timeoutMs)
      sendCommand(cmd, host).catch((e: Error) => {
        clearTimeout(timer)
        off()
        reject(e)
      })
    })
  }

  close() {
    this.ws?.close()
  }
}

const SD_STATUS = /SD printing byte (\d+)\/(\d+)|Not SD printing|No media|No SD card/i

const parseSdStatus = (line: string) => {
  const m = /SD printing byte (\d+)\/(\d+)/i.exec(line)
  if (m) {
    const total = parseInt(m[2], 10)
    return { printing: true, progress: total > 0 ? (parseInt(m[1], 10) / total) * 100 : 0, noCard: false }
  }
  return { printing: false, progress: 0, noCard: /No media|No SD card/i.test(line) }
}

export const uploadToSd = (gcode: string, host: string | undefined, onProgress: (pct: number) => void) =>
  new Promise<void>((resolve, reject) => {
    const blob = new Blob([gcode], { type: 'text/plain' })
    const form = new FormData()
    form.append('path', '/')
    form.append(`${SD_FILENAME}S`, String(blob.size)) // ESP3D checks the size it received against this
    form.append('myfile[]', blob, SD_FILENAME)

    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${baseUrl(host)}/upload`)
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) onProgress((ev.loaded / ev.total) * 100)
    }
    xhr.onerror = () => reject(new Error('Upload failed: the embosser did not respond'))
    xhr.onload = () => {
      if (xhr.status !== 200) {
        reject(new Error(`Upload failed: HTTP ${xhr.status}`))
        return
      }
      let status = ''
      try {
        status = (JSON.parse(xhr.responseText) as { status?: string }).status || ''
      } catch {
        status = xhr.responseText
      }
      if (/no sd card/i.test(status)) reject(new Error('No SD card in the embosser'))
      else if (!/^ok$/i.test(status.trim())) reject(new Error(`Upload failed: ${status || 'unknown error'}`))
      else resolve()
    }
    xhr.send(form)
  })

export const printViaEsp3d = async (gcode: string, opts: IEsp3dOptions): Promise<IEsp3dJob> => {
  const { host, onState, onLog } = opts
  const pollMs = opts.pollMs ?? 2000

  onState({ state: 'connecting', progress: 0 })
  const sock = new MarlinSocket()
  await sock.open(host, await getWebsocketPort(host))
  if (onLog) sock.onLine(onLog)

  // refuse to overwrite a job that is still running
  const before = parseSdStatus(await sock.query('M27', SD_STATUS, host))
  if (before.printing) {
    sock.close()
    throw new Error('The embosser is already printing. Wait for it to finish or cancel it first.')
  }
  if (before.noCard) {
    sock.close()
    throw new Error('No SD card in the embosser')
  }

  onState({ state: 'uploading', progress: 0 })
  await uploadToSd(gcode, host, (pct) => onState({ state: 'uploading', progress: pct }))

  await sendCommand(`M23 ${SD_FILENAME}`, host)
  await sendCommand('M24', host)
  onState({ state: 'printing', progress: 0 })

  let cancelled = false
  const done = new Promise<void>((resolve, reject) => {
    let seenPrinting = false
    let misses = 0
    const startedAt = Date.now()
    const timer = setInterval(() => {
      sock
        .query('M27', SD_STATUS, host)
        .then((line) => {
          misses = 0
          const s = parseSdStatus(line)
          if (s.printing) {
            seenPrinting = true
            onState({ state: 'printing', progress: s.progress })
          } else if (seenPrinting || Date.now() - startedAt > 10000) {
            finish()
            onState({ state: cancelled ? 'cancelled' : 'done', progress: cancelled ? 0 : 100 })
            resolve()
          }
        })
        .catch((e: Error) => {
          // the job keeps running from SD even if we lose contact; give up reporting after ~30 s
          misses += 1
          if (misses * pollMs > 30000) {
            finish()
            reject(new Error(`Lost contact with the embosser (${e.message}). The print continues from the SD card.`))
          }
        })
    }, pollMs)
    const finish = () => {
      clearInterval(timer)
      sock.close()
    }
  })

  const cancel = async () => {
    cancelled = true
    await sendCommand('M524', host)
  }

  return { done, cancel }
}
