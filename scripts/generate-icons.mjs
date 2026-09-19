import sharp from 'sharp'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../public/arrview-icon.svg', import.meta.url))
for (const [size, name] of [[192, 'arrview-icon-192.png'], [512, 'arrview-icon-512.png'], [180, 'apple-touch-icon.png']]) {
  await sharp(source).resize(size, size).png().toFile(new URL(`../public/${name}`, import.meta.url).pathname)
}
// Keep the background edge-to-edge and scale the foreground around the centre.
// Its farthest vertex + stroke fits well inside the central 80%-diameter circle.
const maskable = source.toString()
  .replace('  <!-- Sonarr-inspired', '  <g transform="translate(76.8 76.8) scale(0.85)">\n  <!-- Sonarr-inspired')
  .replace('</svg>', '</g></svg>')
await sharp(Buffer.from(maskable)).resize(512, 512).png()
  .toFile(new URL('../public/arrview-maskable-512.png', import.meta.url).pathname)
