import { test, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import SC from '../../src/screenClass.json'
import { classifyScreen, readInsets, readLargeHeight, keepOutFor } from '../../src/screenClass.js'

// Spec criteria 3, 5 and 36, as amended by the maintainer's Phase 0 notes 1 and 2 (height is the large viewport height,
// short below 700; a coarse short screen wider than tall gets the left rail; the keep-out is a share of the height; railStyle).
const root = path.resolve(__dirname, '../..')
const none = { top: 0, right: 0, bottom: 0, left: 0 }
const right = (r, extra = {}) => ({ ...none, right: r, ...extra })
const left = (l, extra = {}) => ({ ...none, left: l, ...extra })
const at = (width, height, insets = none, coarse = false, options) => classifyScreen({ width, height, insets, coarse }, options)

test('the constants file holds the thresholds, the keep-out and the switches (criterion 3, notes 1 and 2)', () => {
  expect(SC).toMatchObject({ compactBelow: 640, shortBelow: 700, columnMin: 72, columnOtherMax: 20, iconsOnlyBelow: 520,
    statusKeepOutRatio: 0.38, statusKeepOutMin: 90, railPlacement: 'inside', railAnchor: 'bottom', railStyle: 'ios', railWidth: 72 })
  expect(SC).not.toHaveProperty('statusKeepOut')
  expect(SC.ios).toMatchObject({ pitch: 48, pad: 8, gap: 12, pitchTight: 44, padTight: 6, gapTight: 8, bottomMargin: 24 })
  expect(SC.ios.pillWidth).toBeGreaterThanOrEqual(52); expect(SC.ios.pillWidth).toBeLessThanOrEqual(56)
  expect(SC.labelled).toMatchObject({ item: 56, itemIconsOnly: 44 })
})

test('every row of the navigation table (criterion 5 with note 1 item 5)', () => {
  // regular height
  expect(at(402, 874)).toMatchObject({ width: 'compact', height: 'regular', nav: 'bottom', railSide: null, railPlacement: null, column: null })
  expect(at(402, 874, right(84))).toMatchObject({ nav: 'bottom', column: 'right' })
  expect(at(1280, 800)).toMatchObject({ width: 'regular', height: 'regular', nav: 'top', railSide: null })
  expect(at(951, 900, right(84), true)).toMatchObject({ nav: 'top' })
  // short with a column: the rail on the column's side, placement from switch 1, any width or pointer
  expect(at(461, 678, right(84, { bottom: 34 }), true)).toMatchObject({ height: 'short', nav: 'rail', railSide: 'right', railPlacement: 'inside', column: 'right' })
  expect(at(951, 669, right(84), false)).toMatchObject({ nav: 'rail', railSide: 'right', railPlacement: 'inside' })
  expect(at(678, 461, left(84), true)).toMatchObject({ nav: 'rail', railSide: 'left', railPlacement: 'inside', column: 'left' })
  // short, regular, no column, coarse: the left rail beside any inset
  expect(at(874, 402, { top: 0, right: 62, bottom: 21, left: 62 }, true)).toMatchObject({ nav: 'rail', railSide: 'left', railPlacement: 'beside', column: null })
  expect(at(951, 537, { ...none, bottom: 34 }, true)).toMatchObject({ nav: 'rail', railSide: 'left', railPlacement: 'beside' })
  // short, regular, no column, fine: the top bar (with condensed headers)
  expect(at(1280, 600, none, false)).toMatchObject({ height: 'short', nav: 'top', railSide: null })
  // short, compact, no column: the compact bottom bar ... unless coarse and wider than tall (note 1 item 5)
  expect(at(377, 580, none, true)).toMatchObject({ nav: 'bottom-compact' })
  expect(at(375, 667, none, false)).toMatchObject({ nav: 'bottom-compact' })
  expect(at(594, 363, none, true)).toMatchObject({ width: 'compact', nav: 'rail', railSide: 'left', railPlacement: 'beside' })
  expect(at(594, 363, none, false)).toMatchObject({ nav: 'bottom-compact' })
  expect(at(600, 600, none, true)).toMatchObject({ nav: 'bottom-compact' })
})

test('boundaries: 639/640 width, 699/700 height, 71/72 and 19/20 insets, 519/520 icons only', () => {
  expect(at(639, 800).width).toBe('compact'); expect(at(640, 800).width).toBe('regular')
  expect(at(1280, 699).height).toBe('short'); expect(at(1280, 700).height).toBe('regular')
  expect(at(461, 678, right(71)).column).toBe(null); expect(at(461, 678, right(72)).column).toBe('right')
  expect(at(461, 678, left(72)).column).toBe('left')
  expect(at(461, 678, right(84, { left: 19 })).column).toBe('right'); expect(at(461, 678, right(84, { left: 20 })).column).toBe(null)
  expect(at(678, 461, left(84, { right: 20 })).column).toBe(null)
  expect(at(874, 402, { ...none, left: 62, right: 62 }).column).toBe(null) // iPhone landscape: both sides
  expect(at(678, 519, right(84)).iconsOnly).toBe(true); expect(at(678, 520, right(84)).iconsOnly).toBe(false)
})

test('the switches: placement, anchor and rail style (both values of each), and the ios style only inside a column', () => {
  expect(at(461, 678, right(84), true, { railPlacement: 'beside' })).toMatchObject({ railPlacement: 'beside', railStyle: 'labelled' })
  expect(at(461, 678, right(84), true, { railPlacement: 'inside' })).toMatchObject({ railPlacement: 'inside', railStyle: 'ios' })
  expect(at(461, 678, right(84), true, { railAnchor: 'top' }).railAnchor).toBe('top')
  expect(at(461, 678, right(84), true, { railAnchor: 'bottom' }).railAnchor).toBe('bottom')
  expect(at(461, 678, right(84), true, { railStyle: 'labelled' }).railStyle).toBe('labelled')
  expect(at(461, 678, right(84), true, { railStyle: 'ios' }).railStyle).toBe('ios')
  // A rail outside a column is always labelled; no rail, no style.
  expect(at(874, 402, { ...none, left: 62, right: 62 }, true, { railStyle: 'ios' }).railStyle).toBe('labelled')
  expect(at(1280, 800).railStyle).toBe(null)
  expect(at(1280, 800).railAnchor).toBe(null)
  // Defaults come from the JSON.
  expect(at(461, 678, right(84), true)).toMatchObject({ railPlacement: SC.railPlacement, railAnchor: SC.railAnchor, railStyle: SC.railStyle })
})

test('the keep-out: 38% of the large height, shrunk so the rail fits, never below 90 (notes 1 and 2, worked examples)', () => {
  // ios, open wide, show page: the top pill runs 254-366 and the tab pill 389-645.
  expect(keepOutFor({ height: 669, insets: right(84, { bottom: 34 }), style: 'ios', tabs: 5, detail: true })).toBe(254)
  // ios, cover sideways, show page: the keep-out shrinks to 97 (top pill 97-197, tab pill 205-437).
  expect(keepOutFor({ height: 461, insets: left(84), style: 'ios', tabs: 5, detail: true })).toBe(97)
  expect(keepOutFor({ height: 461, insets: left(84), style: 'ios', tabs: 5, detail: false })).toBe(141)
  expect(keepOutFor({ height: 678, insets: right(84, { bottom: 34 }), style: 'ios', tabs: 5 })).toBe(258)
  // Never below 90, even when that leaves no room.
  expect(keepOutFor({ height: 380, insets: right(84), style: 'ios', tabs: 5, detail: true })).toBe(90)
  // labelled: six items above --sa-bottom; 678 x 461 with bottom 21 is the one size that reaches the limit.
  expect(keepOutFor({ height: 678, insets: right(84, { bottom: 34 }), style: 'labelled', tabs: 5 })).toBe(258)
  expect(keepOutFor({ height: 461, insets: left(84, { bottom: 21 }), style: 'labelled', tabs: 5 })).toBe(461 - 21 - SC.labelled.pad - (6 * SC.labelled.itemIconsOnly + 5 * SC.labelled.gap))
  expect(keepOutFor({ height: 461, insets: left(84), style: 'labelled', tabs: 5 })).toBe(175)
})

test('the hook input: the large viewport height decides, not innerHeight (note 1 item 1)', () => {
  // innerHeight -> lvh probe: 714/752 regular, 580/618 short, 678/678 short, 819/902 regular.
  const probe = px => ({ __height: px })
  const style = el => ({ height: el.__height === undefined ? '' : `${el.__height}px` })
  for (const [inner, large, expected] of [[714, 752, 'regular'], [580, 618, 'short'], [678, 678, 'short'], [819, 902, 'regular']]) {
    const height = readLargeHeight(probe(large), inner, { getComputedStyle: style, supportsLvh: true })
    expect(height).toBe(large)
    expect(at(402, height).height, `${inner} / ${large}`).toBe(expected)
  }
  // Unsupported lvh, an empty or a non-px value: innerHeight.
  expect(readLargeHeight(probe(618), 580, { getComputedStyle: style, supportsLvh: false })).toBe(580)
  expect(readLargeHeight(probe(undefined), 580, { getComputedStyle: style, supportsLvh: true })).toBe(580)
  expect(readLargeHeight({}, 580, { getComputedStyle: () => ({ height: '100lvh' }), supportsLvh: true })).toBe(580)
  expect(readLargeHeight(null, 580)).toBe(580)
})

test('readInsets parses the probe padding: px, decimals, empty or unparsable -> 0 (criterion 2)', () => {
  const el = {}
  const style = values => () => ({ paddingTop: values[0], paddingRight: values[1], paddingBottom: values[2], paddingLeft: values[3] })
  expect(readInsets(el, { getComputedStyle: style(['0px', '84px', '34px', '0px']) })).toEqual({ top: 0, right: 84, bottom: 34, left: 0 })
  expect(readInsets(el, { getComputedStyle: style(['62.5px', '0.25px', '20px', '7px']) })).toEqual({ top: 62.5, right: 0.25, bottom: 20, left: 7 })
  expect(readInsets(el, { getComputedStyle: style(['', 'var(--sa-right)', 'auto', undefined]) })).toEqual({ top: 0, right: 0, bottom: 0, left: 0 })
  expect(readInsets(null)).toEqual({ top: 0, right: 0, bottom: 0, left: 0 })
})

// CSS and source guards (criteria 1, 3, 13; note 1 item 1; note 1 item 7).
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)])
const sources = [...walk(path.join(root, 'src')), path.join(root, 'index.html')].filter(file => /\.(css|jsx?|html)$/.test(file))
const read = file => fs.readFileSync(file, 'utf8')

test('env(safe-area-inset-*) is read only in the four :root --sa-* declarations (criterion 1)', () => {
  const uses = sources.flatMap(file => read(file).split('\n').map((line, i) => ({ file: path.relative(root, file), line: line.trim(), n: i + 1 })))
    .filter(({ line }) => /env\(safe-area/.test(line))
  expect(uses.map(u => `${u.file}: ${u.line}`)).toEqual(['top', 'right', 'bottom', 'left'].map(side => `src/index.css: --sa-${side}: env(safe-area-inset-${side}, 0px);`))
  const css = read(path.join(root, 'src/index.css'))
  expect(css.slice(css.indexOf(':root'), css.indexOf('}', css.indexOf(':root')))).toMatch(/--sa-left: env\(safe-area-inset-left, 0px\)/)
})
test('no height media query decides the short layout; sheets key off <html data-screen-height> (note 1 item 1)', () => {
  for (const file of sources.filter(f => f.endsWith('.css'))) expect(read(file), path.relative(root, file)).not.toMatch(/max-height:\s*7\d\dpx\)/)
  expect(read(path.join(root, 'src/components/Sheet.css'))).toMatch(/html\[data-screen-height="short"\]/)
})
test('nothing reads screen.width or screen.height (note 1 item 7); the keep-out is not hard-coded in source', () => {
  for (const file of sources) {
    expect(read(file), path.relative(root, file)).not.toMatch(/\bscreen\.(width|height|availWidth|availHeight)\b/)
    expect(read(file), path.relative(root, file)).not.toMatch(/\b170px\b|0\.38\b/)
  }
})
test('no user-agent or device-name sniffing in the layout code (rule 1)', () => {
  for (const file of ['src/screenClass.js', 'src/hooks/useScreenClass.js', 'src/components/modern/ModernShell.jsx', 'src/components/Sheet.jsx']) {
    expect(read(path.join(root, file)), file).not.toMatch(/userAgent|navigator\.platform|Duo|Fold8|iPhone/)
  }
})
