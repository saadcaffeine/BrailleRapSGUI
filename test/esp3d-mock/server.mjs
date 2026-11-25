// Mock of ESP3DLib 1.x + MarlinBraille2 (xl-sg) for testing the SD-card print flow.
// Scenario (GET /__scenario?mode=...): normal | paperfail | kill | nocard ; &home=<seconds of homing>
import http from 'http'
import fs from 'fs'
import { WebSocketServer } from 'ws'
import Busboy from 'busboy'

const HTTP_PORT = 8080, WS_PORT = 8181
const page = fs.readFileSync(process.argv[2])
let log = []
let scenario = { mode: 'normal', home: 1 }
let sdFile = null, selected = null
let printing = null          // { total, pos, timer }
let homing = false, halted = false, booting = false
let queued = []              // commands Marlin can't run while blocked in G28
let busyTimer = null

const wss = new WebSocketServer({ port: WS_PORT, handleProtocols: (p) => (p.has('arduino') ? 'arduino' : false) })
const clients = new Set()
wss.on('connection', (ws) => { if (booting) return ws.close(); clients.add(ws); ws.send('CURRENT_ID:0'); ws.send('ACTIVE_ID:0'); ws.on('close', () => clients.delete(ws)) })
const reply = (text) => { const b = Buffer.from(text + '\n'); for (const c of clients) c.send(b, { binary: true }) }

const runPrint = () => {
  printing.timer = setInterval(() => {
    printing.pos = Math.min(printing.total, printing.pos + Math.ceil(printing.total / 5))
    if (printing.pos >= printing.total) { clearInterval(printing.timer); printing = null; reply('Done printing file') }
  }, 1000)
}

const startHoming = () => {
  homing = true
  busyTimer = setInterval(() => reply('echo:busy: processing'), 2000)
  setTimeout(() => {
    clearInterval(busyTimer); homing = false
    if (scenario.mode === 'paperfail') { reply('Error:Paper not loaded'); printing = null }
    else if (scenario.mode === 'kill') { reply('Error:Printer halted. kill() called!'); printing = null; halted = true; queued = []; return }
    else runPrint()
    const q = queued; queued = []; q.forEach(marlin)
  }, scenario.home * 1000)
}

const marlin = (cmd) => {
  log.push(cmd)
  if (halted || booting) return                       // dead firmware: no replies at all
  if (homing) { queued.push(cmd); return }           // blocked in G28: commands wait in the queue
  const [g, ...rest] = cmd.split(' ')
  if (g === 'M27') setTimeout(() => reply(printing ? `SD printing byte ${printing.pos}/${printing.total}` : 'Not SD printing'), 30)
  else if (g === 'M119') setTimeout(() => { reply('Reporting endstop status'); reply('x_min: open'); reply('y_min: TRIGGERED'); reply('ok') }, 30)
  else if (g === 'M23') {
    const name = rest.join(' ').trim()
    if (sdFile && name.toLowerCase() === sdFile.name.toLowerCase()) { selected = sdFile; reply(`File opened: ${name} Size: ${sdFile.data.length}`); reply('File selected') }
    else reply(`open failed, File: ${name}.`)
    reply('ok')
  } else if (g === 'M24') {
    if (selected) { printing = { total: selected.data.length, pos: 1 }; reply('ok'); startHoming() } else reply('ok')
  } else if (g === 'M524') { if (printing) { clearInterval(printing.timer); printing = null }; reply('ok') }
  else reply('ok')
}

const restart = () => {
  booting = true; halted = false; homing = false; printing = null; queued = []
  for (const c of clients) c.close()
  setTimeout(() => { booting = false; setTimeout(() => { reply('start'); reply('Marlin 2.1.1.2') }, 300) }, 1500)
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  if (url.pathname === '/braille.html') { res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Encoding': 'gzip' }); return res.end(page) }
  if (url.pathname === '/command') {
    const cmd = url.searchParams.get('commandText') ?? url.searchParams.get('plain') ?? ''
    if (booting) { res.writeHead(503); return res.end('') }
    if (cmd.startsWith('[ESP800]')) { res.writeHead(200); return res.end(`FW version:2.1.2 # FW target:marlin-embedded # webcommunication: Sync: ${WS_PORT} # hostname:marlinesp`) }
    if (cmd.startsWith('[ESP444]')) { log.push(cmd); res.writeHead(200); res.end('Restart ongoing'); return restart() }
    cmd.split('\n').filter(Boolean).forEach(marlin); res.writeHead(200); return res.end('')
  }
  if (url.pathname === '/upload' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    return res.end(JSON.stringify({ status: scenario.mode === 'nocard' ? 'No SD Card' : 'Ok' }))
  }
  if (url.pathname === '/upload' && req.method === 'POST') {
    const bb = Busboy({ headers: req.headers, preservePath: true }); const fields = {}; let file = null
    bb.on('field', (k, v) => (fields[k] = v))
    bb.on('file', (k, stream, info) => { const chunks = []; stream.on('data', (d) => chunks.push(d)); stream.on('end', () => (file = { name: info.filename, data: Buffer.concat(chunks) })) })
    bb.on('close', () => {
      log.push(`UPLOAD ${file?.name} ${file?.data.length} sizeField=${fields[file?.name + 'S']} path=${fields.path}`)
      let status = 'Ok'
      if (scenario.mode === 'nocard') status = 'No SD Card'
      else if (!file || String(file.data.length) !== fields[file.name + 'S']) status = 'Upload failed'
      if (status === 'Ok') { sdFile = file; fs.writeFileSync('uploaded.gco', file.data) }
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ files: [], path: '/', status }))
    })
    return req.pipe(bb)
  }
  if (url.pathname === '/__log') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(log)) }
  if (url.pathname === '/__scenario') {
    scenario = { mode: url.searchParams.get('mode') || 'normal', home: parseFloat(url.searchParams.get('home') || '1') }
    if (url.searchParams.has('reset')) { log = []; halted = false; printing = null; homing = false; queued = [] }
    res.writeHead(200); return res.end(JSON.stringify(scenario))
  }
  res.writeHead(404); res.end('not found')
}).listen(HTTP_PORT, () => console.log('mock ESP3D on', HTTP_PORT, 'ws', WS_PORT))
