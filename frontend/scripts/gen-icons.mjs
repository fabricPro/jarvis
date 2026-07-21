// JARVIS PWA ikonlarını jarvis_icon.svg'den üretir.
// Araç: sharp (Node). Repo kökünden çalıştır:  node frontend/scripts/gen-icons.mjs
// Not: Üretilen PNG'ler public/'te commit'lenir; app derlemesi sharp'a bağımlı DEĞİL.
import sharp from 'sharp'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const svgPath = fileURLToPath(new URL('../public/jarvis_icon.svg', import.meta.url))
const outDir = fileURLToPath(new URL('../public/', import.meta.url))
const svg = readFileSync(svgPath)
const r = (d = 384) => sharp(svg, { density: d })

await r().resize(192, 192).png().toFile(outDir + 'icon-192.png')
await r().resize(512, 512).png().toFile(outDir + 'icon-512.png')
await r().resize(32, 32).png().toFile(outDir + 'favicon.png')
// maskable: şeffaf köşeleri zemin rengiyle doldur (full-bleed) → OS maskesi şeffaf göstermesin
await r().resize(512, 512).flatten({ background: '#151310' }).png().toFile(outDir + 'icon-512-maskable.png')

console.log('İkonlar üretildi:', outDir)
