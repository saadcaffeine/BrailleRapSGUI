// ESP3D HTTP helpers (MarlinBraille2 built with ESP3D_WIFISUPPORT + SDSUPPORT).
// The live connection, status polling and print jobs are in embosser.ts.
//
// Print flow:
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

export const SD_FILENAME = '/braille.gco' // must stay 8.3: ESP3D rewrites names with makepath83

const baseUrl = (host?: string) => {
  if (!host || host === window.location.host) return ''
  return `http://${host}`
}

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

