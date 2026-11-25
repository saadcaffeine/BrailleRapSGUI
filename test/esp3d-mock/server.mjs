// Minimal mock of ESP3DLib 1.x + MarlinBraille2 for testing the SD-card print flow
import http from 'http'
import fs from 'fs'
import { WebSocketServer } from 'ws'
import Busboy from 'busboy'

const HTTP_PORT = 8080, WS_PORT = 8181
const page = fs.readFileSync(process.argv[2])
const log = []                     // every command received, in order
let sdFile = null                  // { name, data }
let printing = null                // { total, pos, timer }
let selected = null
const wss = new WebSocketServer({ port: WS_PORT, handleProtocols: (p) => (p.has('arduino') ? 'arduino' : false) })
const clients = new Set()
wss.on('connection', (ws) => { clients.add(ws); ws.send('CURRENT_ID:0'); ws.send('ACTIVE_ID:0'); ws.on('close', () => clients.delete(ws)) })
const reply = (text) => { const b = Buffer.from(text + '\n'); for (const c of clients) c.send(b, { binary: true }) }

const marlin = (cmd) => {
  log.push(cmd)
  const [g, ...rest] = cmd.split(' ')
  if (g === 'M27') setTimeout(() => reply(printing ? `SD printing byte ${printing.pos}/${printing.total}` : 'Not SD printing'), 50)
  else if (g === 'M23') {
    const name = rest.join(' ').trim()
    if (sdFile && name.toLowerCase() === sdFile.name.toLowerCase()) { selected = sdFile; reply(`File opened: ${name} Size: ${sdFile.data.length}`); reply('File selected') }
    else reply(`open failed, File: ${name}.`)
    reply('ok')
  } else if (g === 'M24') {
    if (selected) {
      printing = { total: selected.data.length, pos: 0 }
      printing.timer = setInterval(() => { printing.pos = Math.min(printing.total, printing.pos + Math.ceil(printing.total / 6)); if (printing.pos >= printing.total) { clearInterval(printing.timer); printing = null; reply('Done printing file') } }, 1000)
    }
    reply('ok')
  } else if (g === 'M524') { if (printing) { clearInterval(printing.timer); printing = null }; reply('ok') }
  else reply('ok')
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  if (url.pathname === '/braille.html') {
    res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Encoding': 'gzip' }); return res.end(page)
  }
  if (url.pathname === '/command') {
    const cmd = url.searchParams.get('commandText') ?? url.searchParams.get('plain') ?? ''
    if (cmd.startsWith('[ESP800]')) { res.writeHead(200); return res.end(`FW version:2.1.2 # FW target:marlin-embedded # FW HW:Direct SD # primary : /sd/ # authentication:no # webcommunication: Sync: ${WS_PORT} # hostname:marlinesp # axis:3`) }
    cmd.split('\n').filter(Boolean).forEach(marlin); res.writeHead(200); return res.end('Ok')
  }
  if (url.pathname === '/upload' && req.method === 'POST') {
    const bb = Busboy({ headers: req.headers, preservePath: true }); const fields = {}; let file = null
    bb.on('field', (k, v) => (fields[k] = v))
    bb.on('file', (k, stream, info) => { const chunks = []; stream.on('data', (d) => chunks.push(d)); stream.on('end', () => (file = { name: info.filename, data: Buffer.concat(chunks) })) })
    bb.on('close', () => {
      log.push(`UPLOAD ${file?.name} ${file?.data.length} sizeField=${fields[file?.name + 'S']} path=${fields.path}`)
      const ok = file && String(file.data.length) === fields[file.name + 'S']
      if (ok) { sdFile = file; fs.writeFileSync('uploaded.gco', file.data) }
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ files: [], path: '/', status: ok ? 'Ok' : 'Upload failed' }))
    })
    return req.pipe(bb)
  }
  if (url.pathname === '/__log') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(log)) }
  res.writeHead(404); res.end('not found')
}).listen(HTTP_PORT, () => console.log('mock ESP3D on', HTTP_PORT, 'ws', WS_PORT))
