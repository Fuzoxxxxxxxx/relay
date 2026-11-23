/**
 * Génère les icônes Windows de Relay à partir du logo vectoriel (public/favicon.svg).
 *
 *   npm i -D sharp
 *   npm run icons
 *
 * Produit build/icon.ico (installateur, exécutable, raccourcis) et build/icon.png.
 * electron-builder utilise automatiquement build/icon.ico.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const svg = await readFile(path.join(root, 'public', 'favicon.svg'))
const sizes = [16, 24, 32, 48, 64, 128, 256]

const render = (size) => sharp(svg, { density: 512 }).resize(size, size).png().toBuffer()
const pngs = await Promise.all(sizes.map(render))

// Fichier .ico : en-tête, une entrée par taille, puis les images PNG.
const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0) // réservé
header.writeUInt16LE(1, 2) // type : icône
header.writeUInt16LE(sizes.length, 4)

let offset = header.length + 16 * sizes.length
const entries = sizes.map((size, index) => {
  const entry = Buffer.alloc(16)
  entry.writeUInt8(size >= 256 ? 0 : size, 0) // largeur (0 = 256)
  entry.writeUInt8(size >= 256 ? 0 : size, 1) // hauteur
  entry.writeUInt16LE(1, 4) // plans
  entry.writeUInt16LE(32, 6) // bits par pixel
  entry.writeUInt32LE(pngs[index].length, 8)
  entry.writeUInt32LE(offset, 12)
  offset += pngs[index].length
  return entry
})

const buildDir = path.join(root, 'build')
await mkdir(buildDir, { recursive: true })
await writeFile(path.join(buildDir, 'icon.ico'), Buffer.concat([header, ...entries, ...pngs]))
await writeFile(path.join(buildDir, 'icon.png'), await render(512))
console.log(`Icônes générées dans ${buildDir} (icon.ico : ${sizes.join(', ')} px, icon.png : 512 px).`)
