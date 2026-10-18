import { test, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
function walk(dir, out = []) {
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = path.posix.join(dir, entry.name)
    if (entry.isDirectory()) walk(rel, out)
    else if (/\.(jsx?|css|html)$/.test(entry.name)) out.push(rel)
  }
  return out
}
const sources = [...walk('src'), 'index.html', 'public/offline.html', 'public/offline.css', 'public/offline.js', 'vite.config.js']

test('the scanned sources cover the Modern components and the shared media helpers', () => {
  for (const file of ['src/media.js', 'src/sections.js', 'src/components/modern/ModernShell.jsx', 'src/components/modern/ShowPage.jsx',
    'src/components/modern/MoviePage.jsx', 'src/components/modern/modern.css', 'src/components/MediaSheets.jsx',
    'src/upcoming.js', 'src/hooks/useUpcoming.js', 'src/components/modern/UpcomingPage.jsx',
    'src/downloads.js', 'src/hooks/useDownloads.jsx', 'src/components/modern/DownloadsPage.jsx', 'src/components/modern/DownloadPill.jsx',
    'src/components/modern/DownloadStatus.jsx']) expect(sources, file).toContain(file)
})

const CANVAS = '#0b0b0c'
const INTER_SHA256 = '693b77d4f32ee9b8bfc995589b5fad5e99adf2832738661f5402f9978429a8e3'
const INTER_LICENSE_SHA256 = '262481e844521b326f5ecd053e59b98c8b2da78c8ee1bdbb6e8174305e54935a'

test('no light colour scheme anywhere in the app or offline page', () => {
  for (const file of sources) expect(read(file), file).not.toMatch(/prefers-color-scheme/)
  expect((read('src/index.css').match(/color-scheme:\s*dark/g) || [])).toHaveLength(1)
  expect(read('src/responsive.css')).not.toMatch(/color-scheme/)
})
test('one theme-color meta each, no media attribute, matching the manifest', () => {
  for (const file of ['index.html', 'public/offline.html']) {
    const metas = read(file).match(/<meta[^>]*name="theme-color"[^>]*>/g) || []
    expect(metas, file).toHaveLength(1)
    expect(metas[0]).toContain(`content="${CANVAS}"`)
    expect(metas[0]).not.toContain('media=')
  }
  const vite = read('vite.config.js')
  expect(vite).toContain(`background_color: '${CANVAS}'`)
  expect(vite).toContain(`theme_color: '${CANVAS}'`)
  expect(vite).toMatch(/globPatterns:[^\]]*woff2/)
})
test('canvas token is the neutral dark colour and offline css uses Inter without a light override', () => {
  expect(read('src/index.css')).toContain(`--canvas:   ${CANVAS}`)
  const offline = read('public/offline.css')
  expect(offline).toContain("'Inter'")
  expect(offline).toContain('/fonts/inter/InterVariable.woff2')
})
test('no GitHub Primer palette values remain', () => {
  const primer = /#0d1117|#161b22|#1c2128|#22272e|#30363d|#58a6ff|#79c0ff|#bc8cff|#3fb950|#d29922|#f85149/i
  for (const file of sources) expect(read(file), file).not.toMatch(primer)
  expect(read('src/index.css')).not.toMatch(/--purple|--accent\b/)
})
test('Inter is declared once, self-hosted, with the system fallback stack', () => {
  const css = read('src/index.css')
  expect(css.match(/@font-face/g)).toHaveLength(1)
  expect(css).toContain("src: url('/fonts/inter/InterVariable.woff2') format('woff2')")
  expect(css).toMatch(/font-weight:\s*100 900/)
  expect(css).toMatch(/font-display:\s*swap/)
  expect(css).toContain("font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif")
  expect(css).toContain('font-optical-sizing: auto')
  const fonts = fs.readdirSync(path.join(root, 'public/fonts/inter')).sort()
  expect(fonts).toEqual(['InterVariable.woff2', 'LICENSE.txt'])
})
test('vendored Inter files match the upstream checksums', () => {
  const sha = file => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')
  expect(sha('public/fonts/inter/InterVariable.woff2')).toBe(INTER_SHA256)
  expect(sha('public/fonts/inter/LICENSE.txt')).toBe(INTER_LICENSE_SHA256)
  expect(fs.existsSync(path.join(root, 'licenses/phosphor-icons-MIT.txt'))).toBe(true)
})
test('no third-party origin in stylesheets or the HTML shell', () => {
  for (const file of sources.filter(f => /\.css$|index\.html$|offline\.html$/.test(f))) {
    const text = read(file)
    expect(text, file).not.toMatch(/url\(\s*['"]?https?:/)
    expect(text, file).not.toMatch(/<link[^>]*href="https?:/)
  }
})
test('progress fill and status dots have no gradients or glows', () => {
  const css = read('src/index.css')
  expect(css).not.toMatch(/linear-gradient|text-shadow/)
  expect(css).not.toMatch(/\.status-dot\.online[^}]*box-shadow/)
  for (const file of sources.filter(f => f.endsWith('.css'))) {
    for (const line of read(file).split('\n').filter(l => /gradient/.test(l))) expect(line, file).toMatch(/rgba\(0,\s*0,\s*0/)
  }
})

// Glyph scan: every icon is set artwork from the Icon component; no emoji, arrows, dingbats or symbols.
// Ranges: arrows 2190-21FF, technical 2300-23FF, geometric shapes 25A0-25FF, misc symbols and dingbats
// 2600-27BF (includes check and cross marks), 2B00-2BFF, emoji 1F000-1FAFF, plus the info source,
// circled/enclosed forms, variation selector and vertical ellipsis.
const GLYPH_RANGES = [[0x1F000, 0x1FAFF], [0x2190, 0x21FF], [0x2300, 0x23FF], [0x2460, 0x27BF], [0x2900, 0x2BFF],
  [0x2139, 0x2139], [0x25A0, 0x25FF], [0xFE0F, 0xFE0F], [0x22EE, 0x22EE]]
// Allowed: the typographic arrows and the vertical ellipsis in InstallHelp's prose, which describe the browser's own menus.
const ALLOWED = [
  { file: 'src/components/InstallHelp.jsx', chars: ['→', '⋮'] },
]
const publicFiles = (function walkPublic(dir, out = []) {
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = path.posix.join(dir, entry.name)
    if (entry.isDirectory()) walkPublic(rel, out)
    else if (/\.(jsx?|css|html|json|webmanifest|svg)$/.test(entry.name)) out.push(rel)
  }
  return out
})('public')
test('no glyph icons remain in src/, public/ or index.html', () => {
  const offenders = []
  for (const file of [...new Set([...sources, ...publicFiles])]) {
    let text = read(file)
    for (const rule of ALLOWED.filter(r => r.file === file)) {
      if (rule.chars) for (const c of rule.chars) text = text.split(c).join('')
    }
    for (const ch of text) {
      const code = ch.codePointAt(0)
      if (GLYPH_RANGES.some(([lo, hi]) => code >= lo && code <= hi)) offenders.push(`${file}: U+${code.toString(16).toUpperCase()}`)
    }
  }
  expect([...new Set(offenders)]).toEqual([])
})
