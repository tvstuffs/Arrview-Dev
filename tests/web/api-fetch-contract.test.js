import fs from 'node:fs'
import path from 'node:path'
import { test, expect } from 'vitest'

const SRC = path.resolve(__dirname, '../../src')
const files = (dir => {
  const out = []
  const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(js|jsx)$/.test(e.name) && !/\.test\./.test(e.name)) out.push(p) } }
  walk(dir)
  return out
})(SRC)

// Blanks comments, strings and template text but keeps line structure; the original lines are kept for the string rules.
function strip(text) {
  let out = '', i = 0
  const keep = ch => (ch === '\n' ? '\n' : ' ')
  while (i < text.length) {
    const c = text[i], n = text[i + 1]
    if (c === '/' && n === '/') { while (i < text.length && text[i] !== '\n') { out += ' '; i++ } continue }
    if (c === '/' && n === '*') { while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) { out += keep(text[i]); i++ } out += '  '; i += 2; continue }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c; out += quote; i++
      while (i < text.length && text[i] !== quote) {
        if (text[i] === '\\') { out += '  '; i += 2; continue }
        if (quote === '`' && text[i] === '$' && text[i + 1] === '{') {
          let depth = 0
          while (i < text.length) { const d = text[i]; out += d; i++; if (d === '{') depth++; if (d === '}' && --depth === 0) break }
          continue
        }
        out += keep(text[i]); i++
      }
      out += quote; i++; continue
    }
    out += c; i++
  }
  return out
}
const rel = f => path.relative(path.resolve(__dirname, '../..'), f)
const lineOf = (text, index) => text.slice(0, index).split('\n').length

function findings() {
  const bad = []
  for (const file of files) {
    const raw = fs.readFileSync(file, 'utf8')
    const code = strip(raw)
    const isApi = rel(file) === 'src/api.js'
    const isLifecycle = rel(file) === 'src/hooks/lifecycle.jsx'
    const report = (index, why) => bad.push(`${rel(file)}:${lineOf(raw, index)} ${why}`)
    for (const m of code.matchAll(/\bfetch\b/g)) if (!isApi) report(m.index, 'bare fetch')
    for (const m of code.matchAll(/\b(?:window|globalThis|self)\s*\.\s*fetch\b/g)) report(m.index, 'global fetch')
    for (const m of code.matchAll(/XMLHttpRequest|sendBeacon/g)) report(m.index, m[0])
    for (const m of code.matchAll(/\bEventSource\b/g)) if (!isLifecycle) report(m.index, 'EventSource outside lifecycle.jsx')
    if (isLifecycle) for (const m of raw.matchAll(/new EventSource\(([^)]*)\)/g)) if (m[1].trim() !== "'/api/events'") report(m.index, `EventSource url ${m[1]}`)
    for (const m of raw.matchAll(/(['"`])((?:\\.|(?!\1)[^\\])*)\1/g)) {
      if (m[2].includes('/api/') && /token=|apikey=|access_key|password=/i.test(m[2])) report(m.index, 'secret in an /api/ url')
    }
  }
  return bad
}

test('src has no bare fetch, XHR, beacon, stray EventSource or secret in a URL', () => {
  expect(files.length).toBeGreaterThan(30)
  expect(findings()).toEqual([])
})

test('the checks catch a bare fetch (self-check on a sample)', () => {
  const sample = strip("const a = 1 // fetch(\nconst b = 'fetch('\nawait fetch('/api/x')\n")
  expect([...sample.matchAll(/\bfetch\b/g)].length).toBe(1)
})

test('api.js sets the header and checkedFetch calls apiFetch', () => {
  const api = fs.readFileSync(path.join(SRC, 'api.js'), 'utf8')
  expect(api).toContain('X-Requested-With')
  expect(api).toContain('ArrView')
  const actions = fs.readFileSync(path.join(SRC, 'actions.js'), 'utf8')
  expect(actions).toMatch(/export async function checkedFetch[\s\S]*?apiFetch\(/)
})
