// Generates build/icon.png (256) and build/tray.png (32) with no external deps.
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

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
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])))
  return Buffer.concat([len, typeBuf, data, crc])
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

function roundedRectSDF(x, y, w, h, r) {
  const qx = Math.abs(x - w / 2) - (w / 2 - r)
  const qy = Math.abs(y - h / 2) - (h / 2 - r)
  const ox = Math.max(qx, 0)
  const oy = Math.max(qy, 0)
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r
}

function segmentDistance(px, py, ax, ay, bx, by) {
  const vx = bx - ax
  const vy = by - ay
  const wx = px - ax
  const wy = py - ay
  const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / (vx * vx + vy * vy)))
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy))
}

function render(size) {
  const ss = 4
  const S = size * ss
  const out = Buffer.alloc(size * size * 4)
  const r = S * 0.22
  const pts = [
    [S * 0.28, S * 0.52],
    [S * 0.44, S * 0.68],
    [S * 0.73, S * 0.33]
  ]
  const stroke = S * 0.075

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let acc = [0, 0, 0, 0]
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const px = x * ss + sx + 0.5
          const py = y * ss + sy + 0.5
          const inside = roundedRectSDF(px, py, S, S, r) <= 0
          if (!inside) continue
          const t = py / S
          let cr = Math.round(43 + (15 - 43) * t)
          let cg = Math.round(136 + (91 - 136) * t)
          let cb = Math.round(240 + (189 - 240) * t)
          const d = Math.min(
            segmentDistance(px, py, pts[0][0], pts[0][1], pts[1][0], pts[1][1]),
            segmentDistance(px, py, pts[1][0], pts[1][1], pts[2][0], pts[2][1])
          )
          const cap = Math.min(
            Math.hypot(px - pts[0][0], py - pts[0][1]),
            Math.hypot(px - pts[2][0], py - pts[2][1])
          )
          if (Math.min(d, cap) <= stroke / 2) {
            cr = 255
            cg = 255
            cb = 255
          }
          acc[0] += cr
          acc[1] += cg
          acc[2] += cb
          acc[3] += 255
        }
      }
      const n = ss * ss
      const i = (y * size + x) * 4
      const a = acc[3] / n
      out[i] = a ? Math.round(acc[0] / (acc[3] / 255 || 1)) : 0
      out[i + 1] = a ? Math.round(acc[1] / (acc[3] / 255 || 1)) : 0
      out[i + 2] = a ? Math.round(acc[2] / (acc[3] / 255 || 1)) : 0
      out[i + 3] = Math.round(a)
    }
  }
  return encodePng(size, size, out)
}

const buildDir = join(process.cwd(), 'build')
mkdirSync(buildDir, { recursive: true })
writeFileSync(join(buildDir, 'icon.png'), render(256))
writeFileSync(join(buildDir, 'tray.png'), render(32))
console.log('icons written')
