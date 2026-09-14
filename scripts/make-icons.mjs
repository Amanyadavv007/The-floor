// Generates the PWA icon set (plain Node, no dependencies).
// Design: dark canvas + three ascending teal steps — "floors", the app's motif.
// Run: node scripts/make-icons.mjs
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons')

const BG = [0x14, 0x17, 0x1b, 255] // #14171B — app background
const GO = [0x6f, 0xa8, 0xa6, 255] // #6FA8A6 — app accent
const GO_DIM = [0x4f, 0x83, 0x82, 255] // slightly darker teal

// ---------- minimal PNG encoder ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'ascii')
  data.copy(out, 8)
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 8 + data.length)
  return out
}
function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0 // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ---------- icon painter ----------
// S keeps a design grid: coordinates are in 48ths of the canvas.
function paint(size, { pad = 0 } = {}) {
  const px = Buffer.alloc(size * size * 4)
  const S = size / 48
  function rect(x, y, w, h, color) {
    const x0 = Math.round((x + pad) * S)
    const y0 = Math.round((y + pad) * S)
    const x1 = Math.round((x + pad + w) * S)
    const y1 = Math.round((y + pad + h) * S)
    for (let yy = Math.max(0, y0); yy < Math.min(size, y1); yy++) {
      for (let xx = Math.max(0, x0); xx < Math.min(size, x1); xx++) {
        const i = (yy * size + xx) * 4
        px[i] = color[0]
        px[i + 1] = color[1]
        px[i + 2] = color[2]
        px[i + 3] = color[3]
      }
    }
  }
  // background
  for (let i = 0; i < px.length; i += 4) {
    px[i] = BG[0]
    px[i + 1] = BG[1]
    px[i + 2] = BG[2]
    px[i + 3] = 255
  }
  // three ascending floors (left-to-right staircase)
  rect(9, 30, 8, 9, GO_DIM)
  rect(19, 22, 8, 17, GO)
  rect(29, 13, 8, 26, GO)
  return encodePNG(size, size, px)
}

mkdirSync(OUT_DIR, { recursive: true })
const targets = [
  { file: 'icon-192.png', size: 192, pad: 0 },
  { file: 'icon-512.png', size: 512, pad: 0 },
  { file: 'icon-maskable-512.png', size: 512, pad: 4.5 }, // safe-zone padding
  { file: 'apple-touch-icon.png', size: 180, pad: 0 },
]
for (const t of targets) {
  writeFileSync(join(OUT_DIR, t.file), paint(t.size, { pad: t.pad }))
  console.log('wrote', t.file)
}
