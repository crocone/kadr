/**
 * Icons are drawn in code — no third-party assets in the repo (PLAN.md §9).
 * The script writes PNGs by hand via zlib to avoid a canvas dependency in devDeps.
 *
 *   node scripts/gen-icons.mjs
 */
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'icons')
const SIZES = [16, 32, 48, 128]
const SUPERSAMPLE = 4

/** Diagonal indigo → violet gradient, same as the default background preset. */
const GRADIENT_FROM = [79, 70, 229]
const GRADIENT_TO = [168, 85, 247]

const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0 // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** Signed distance to a rounded rectangle; < 0 means inside. */
function roundedRectSdf(x, y, halfW, halfH, radius) {
  const dx = Math.abs(x) - (halfW - radius)
  const dy = Math.abs(y) - (halfH - radius)
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0))
  return outside + Math.min(Math.max(dx, dy), 0) - radius
}

/** Viewfinder corner: a frame with the middles of its sides cut away. */
function inViewfinder(x, y, half, thickness, armRatio) {
  const outer = roundedRectSdf(x, y, half, half, half * 0.28)
  if (outer > 0 || outer < -thickness) return false
  const arm = half * armRatio
  return Math.abs(x) > half - arm && Math.abs(y) > half - arm
}

function renderIcon(size) {
  const ss = size * SUPERSAMPLE
  const acc = new Float32Array(size * size * 4)
  const half = ss / 2

  for (let sy = 0; sy < ss; sy++) {
    for (let sx = 0; sx < ss; sx++) {
      const x = sx + 0.5 - half
      const y = sy + 0.5 - half
      let r = 0
      let g = 0
      let b = 0
      let a = 0

      const plate = roundedRectSdf(x, y, half * 0.96, half * 0.96, ss * 0.24)
      if (plate <= 0) {
        const t = Math.min(1, Math.max(0, (sx + sy) / (2 * ss)))
        r = GRADIENT_FROM[0] + (GRADIENT_TO[0] - GRADIENT_FROM[0]) * t
        g = GRADIENT_FROM[1] + (GRADIENT_TO[1] - GRADIENT_FROM[1]) * t
        b = GRADIENT_FROM[2] + (GRADIENT_TO[2] - GRADIENT_FROM[2]) * t
        a = 255

        if (inViewfinder(x, y, half * 0.52, ss * 0.075, 0.42)) {
          r = g = b = 255
        }
      }

      const px = ((sy / SUPERSAMPLE) | 0) * size + ((sx / SUPERSAMPLE) | 0)
      acc[px * 4] += r
      acc[px * 4 + 1] += g
      acc[px * 4 + 2] += b
      acc[px * 4 + 3] += a
    }
  }

  const samples = SUPERSAMPLE * SUPERSAMPLE
  const out = Buffer.alloc(size * size * 4)
  for (let i = 0; i < size * size; i++) {
    for (let c = 0; c < 4; c++) out[i * 4 + c] = Math.round(acc[i * 4 + c] / samples)
  }
  return out
}

mkdirSync(OUT_DIR, { recursive: true })
for (const size of SIZES) {
  const file = resolve(OUT_DIR, `icon-${size}.png`)
  writeFileSync(file, encodePng(size, renderIcon(size)))
  console.log(`wrote ${file}`)
}
