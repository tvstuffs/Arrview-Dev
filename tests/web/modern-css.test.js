import { test, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(__dirname, '../..')
const css = fs.readFileSync(path.join(root, 'src/components/modern/modern.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const rules = []
for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) rules.push({ selector: m[1].trim(), body: m[2] })

// The only nonzero border allowed anywhere: the sheet form fields restore their hairline border on keyboard focus.
const SHEET_FIELD_SELECTOR = '.m-sheet.m-sheet input:focus-visible, .m-sheet.m-sheet select:focus-visible, .m-sheet.m-sheet textarea:focus-visible'
const SHEET_FIELD_BORDER = 'border-color: var(--hair-2)'
function parseRules(source) {
  return [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => ({ selector: m[1].trim().replace(/\s+/g, ' '), body: m[2] }))
}
function borderViolations(list) {
  const bad = []
  for (const { selector, body } of list) {
    for (const decl of body.split(';')) {
      const match = /^\s*border(?!-radius)[\w-]*\s*:\s*(.*)$/.exec(decl)
      if (!match) continue
      if (/^(0|none)$/.test(match[1].trim())) continue
      if (selector === SHEET_FIELD_SELECTOR && decl.trim().replace(/\s+/g, ' ') === SHEET_FIELD_BORDER) continue
      bad.push(`${selector} { ${decl.trim()} }`)
    }
  }
  return bad
}

test('the border guard rejects a focus-visible border on a tile and allows only the sheet-field rule', () => {
  expect(borderViolations(parseRules('.m-tile:focus-visible { border: 1px solid red; }'))).toHaveLength(1)
  expect(borderViolations(parseRules('.m-tile:focus-visible { border-color: var(--hair-2); }'))).toHaveLength(1)
  expect(borderViolations(parseRules('.m-shell :focus-visible { border-color: var(--hair-2); }'))).toHaveLength(1)
  expect(borderViolations(parseRules(`${SHEET_FIELD_SELECTOR} { outline: 2px solid var(--text); border-color: var(--hair-2); }`))).toEqual([])
  expect(borderViolations(parseRules(`${SHEET_FIELD_SELECTOR} { border: 1px solid red; }`))).toHaveLength(1)
})
test('Modern CSS uses the live colour exactly once, for the Today label, and has no light colour scheme (criteria 11, 33; job 004 D23)', () => {
  expect(css.match(/--live/g)).toHaveLength(1)
  const today = rules.find(r => r.selector === '.m-agenda-day.is-today .m-agenda-rel')
  expect(today).toBeDefined()
  expect(today.body).toMatch(/var\(--live\)/)
  expect(css).not.toMatch(/prefers-color-scheme/)
  expect(css).not.toMatch(/color-scheme/)
})
test('the neutral focus ring rule is declared with the text colour (D29)', () => {
  const rule = rules.find(r => r.selector === '.m-shell :focus-visible')
  expect(rule).toBeDefined()
  expect(rule.body).toMatch(/outline:\s*2px solid var\(--text\)/)
  const fields = rules.find(r => r.selector.startsWith('.m-shell.m-shell input:focus-visible'))
  expect(fields.body).toMatch(/outline:\s*2px solid var\(--text\)/)
})
test('every selector is prefixed m- (Classic CSS stays untouched)', () => {
  for (const { selector } of rules) {
    for (const part of selector.split(',').map(s => s.trim()).filter(Boolean)) {
      if (/^\d+%$|^(from|to)$/.test(part)) continue
      expect(part, selector).toMatch(/^\.m-/)
    }
  }
})
test('gradients appear only as scrims and masks over artwork, boxes only on the movie poster (criterion 11)', () => {
  const gradientOk = ['.m-overlay', '.m-hero-art']
  const shadowOk = ['.m-movie-poster .m-art']
  for (const { selector, body } of rules) {
    if (/gradient/.test(body)) expect(gradientOk, `gradient in ${selector}`).toContain(selector)
    if (/box-shadow/.test(body)) expect(shadowOk, `box-shadow in ${selector}`).toContain(selector)
  }
  expect(borderViolations(rules)).toEqual([])
  const bar = rules.find(r => r.selector === '.m-tilebar span')
  expect(bar.body).not.toMatch(/gradient/)
})
test('overlay Download is compact and filled, and the overlay appears without a fade so no button is clickable half-visible (rework 2)', () => {
  expect(rules.find(r => r.selector === '.m-overlay').body).not.toMatch(/transition/)
  const download = rules.find(r => r.selector.startsWith('.m-overlay .btn-attn,'))
  expect(download.body).toMatch(/flex:\s*0 0 auto/)
  expect(download.body).toMatch(/border:\s*0/)
  expect(download.body).toMatch(/background:\s*var\(--attn\)/)
  expect(css).not.toMatch(/\.m-overlay \.btn-attn\s*\{[^}]*100%/)
})
test('tiles, rows and bars carry no outlines other than the focus ring (criterion 11)', () => {
  for (const { selector, body } of rules) {
    if (/:focus-visible/.test(selector)) continue
    expect(body, selector).not.toMatch(/outline\s*:\s*[1-9]/)
  }
})
test('Modern CSS has its own reduced-motion block that zeroes durations (criterion 29)', () => {
  const start = css.indexOf('@media (prefers-reduced-motion: reduce)')
  expect(start).toBeGreaterThan(-1)
  const block = css.slice(start)
  expect(block).toMatch(/transition-duration:\s*0s/)
  expect(block).toMatch(/animation-duration:\s*0s/)
})
test('hero text and artwork sit in separate grid columns so the title never overlaps the art (D22)', () => {
  const hero = rules.find(r => r.selector === '.m-hero')
  expect(hero.body).toMatch(/grid-template-columns/)
  expect(rules.find(r => r.selector === '.m-hero-art').body).toMatch(/grid-column:\s*2/)
  expect(rules.find(r => r.selector === '.m-hero-body').body).toMatch(/grid-column:\s*1/)
})
test('clamps and aspect ratios the criteria rely on are declared', () => {
  expect(rules.find(r => r.selector === '.m-overview').body).toMatch(/-webkit-line-clamp:\s*3/)
  expect(rules.find(r => r.selector === '.m-ep-overview').body).toMatch(/-webkit-line-clamp:\s*2/)
  expect(rules.find(r => r.selector === '.m-art-poster').body).toMatch(/aspect-ratio:\s*2 \/ 3/)
  expect(rules.find(r => r.selector === '.m-art-still').body).toMatch(/aspect-ratio:\s*16 \/ 9/)
  expect(rules.find(r => r.selector === '.m-utile-box').body).toMatch(/aspect-ratio:\s*16 \/ 9/)
})
test('Upcoming tiles use flat colours: no borders, shadows or gradients, and the stacked-card look is pseudo-elements (job 004 D17, D23)', () => {
  const upcoming = rules.filter(r => /\.m-(agenda|utile|ulist|uerror)/.test(r.selector))
  expect(upcoming.length).toBeGreaterThan(20)
  for (const { selector, body } of upcoming) expect(body, selector).not.toMatch(/gradient|box-shadow|border(?!-radius)/)
  expect(rules.some(r => r.selector === '.m-utile.is-drop .m-utile-stack::before')).toBe(true)
  expect(rules.some(r => r.selector === '.m-utile.is-drop .m-utile-stack::after')).toBe(true)
})
