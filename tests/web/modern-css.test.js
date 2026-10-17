import { test, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(__dirname, '../..')
const css = fs.readFileSync(path.join(root, 'src/components/modern/modern.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const rules = []
for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) rules.push({ selector: m[1].trim(), body: m[2] })

test('Modern CSS never references the live colour and has no light colour scheme (criteria 11, 33)', () => {
  expect(css).not.toMatch(/--live/)
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
    if (/:focus-visible/.test(selector)) continue
    for (const decl of body.split(';')) {
      const match = /^\s*border(?!-radius)[\w-]*\s*:\s*(.*)$/.exec(decl)
      if (match) expect(match[1].trim(), `border in ${selector}`).toMatch(/^(0|none)$/)
    }
  }
  const bar = rules.find(r => r.selector === '.m-tilebar span')
  expect(bar.body).not.toMatch(/gradient/)
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
})
