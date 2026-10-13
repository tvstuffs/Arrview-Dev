import { test, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// Static client contract: the server answers 415 to non-JSON POST/PUT/PATCH
// under /api, so every mutating fetch in src/ must send application/json.
const SRC = path.resolve(__dirname, '../../src')

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return walk(full)
    return /\.(jsx?|mjs|cjs)$/.test(entry.name) && !/\.test\./.test(entry.name) ? [full] : []
  })
}

// Index just past the string/template literal starting at i.
function skipString(text, i) {
  const quote = text[i]
  i++
  while (i < text.length && text[i] !== quote) {
    if (text[i] === '\\') { i += 2; continue }
    if (quote === '`' && text[i] === '$' && text[i + 1] === '{') {
      i = skipBalanced(text, i + 1, '{', '}')
      continue
    }
    i++
  }
  return i + 1
}

// Index just past the bracket group opening at i (string-aware).
function skipBalanced(text, i, open, close) {
  let depth = 0
  while (i < text.length) {
    const c = text[i]
    if (c === '"' || c === "'" || c === '`') { i = skipString(text, i); continue }
    if (c === open) depth++
    else if (c === close && --depth === 0) return i + 1
    i++
  }
  return i
}

// Top-level `{...}` groups inside a call's argument text.
function topLevelObjects(args) {
  const objects = []
  let i = 0
  while (i < args.length) {
    const c = args[i]
    if (c === '"' || c === "'" || c === '`') { i = skipString(args, i); continue }
    if (c === '{') { const end = skipBalanced(args, i, '{', '}'); objects.push(args.slice(i, end)); i = end; continue }
    if (c === '(') { i = skipBalanced(args, i, '(', ')'); continue }
    if (c === '[') { i = skipBalanced(args, i, '[', ']'); continue }
    i++
  }
  return objects
}

function scan(file) {
  const text = fs.readFileSync(file, 'utf8')
  const found = []
  const re = /\b(?:checkedFetch|fetch)\(/g
  let m
  while ((m = re.exec(text))) {
    const open = m.index + m[0].length - 1
    const end = skipBalanced(text, open, '(', ')')
    const args = text.slice(open + 1, end - 1)
    for (const options of topLevelObjects(args)) {
      if (!/\bmethod\s*:\s*(['"])(?:POST|PUT|PATCH)\1/.test(options)) continue
      const line = text.slice(0, m.index).split('\n').length
      const ok = /['"]?Content-Type['"]?\s*:\s*(['"])application\/json\1/.test(options)
      found.push({ file: path.relative(SRC, file), line, ok })
    }
  }
  return found
}

test('every mutating fetch in src/ sends Content-Type: application/json', () => {
  const calls = walk(SRC).flatMap(scan)
  const offenders = calls.filter(c => !c.ok).map(c => `${c.file}:${c.line}`)
  expect(offenders).toEqual([])
  for (const name of ['actions.js', 'DownloadsTab.jsx', 'ShowsTab.jsx', 'MoviesTab.jsx', 'ConfigPage.jsx']) {
    expect(calls.some(c => path.basename(c.file) === name), `no mutating call found in ${name}`).toBe(true)
  }
})
