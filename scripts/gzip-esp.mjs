// Gzip dist-esp/braille.html -> dist-esp/braille.html.gz for upload to the ESP32 (ESP3D SPIFFS)
import { readFileSync, writeFileSync } from 'fs'
import { gzipSync } from 'zlib'

const src = 'dist-esp/braille.html'
const html = readFileSync(src)
const gz = gzipSync(html, { level: 9 })
writeFileSync(`${src}.gz`, gz)
console.log(`${src}: ${(html.length / 1024).toFixed(0)} KB -> ${src}.gz: ${(gz.length / 1024).toFixed(0)} KB`)
