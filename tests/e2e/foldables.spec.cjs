// Foldables and short screens (spec criteria 8-11, 22-27, 31-35, 39; plan section 8; the maintainer's Phase 0 note).
// Sizes, insets and expected screen classes: foldable-sizes.cjs. Thresholds and the keep-out: src/screenClass.json.
// Insets are emulated by setting --sa-* inline on <html> (Chromium cannot emulate env(safe-area-inset-*)).
const fs = require('node:fs')
const path = require('node:path')
const { test, expect } = require('@playwright/test')
const { SIZES, REGRESSION, KEYBOARD, FOLD, inset } = require('./foldable-sizes.cjs')

// The constants file is new in this change; a missing file fails the tests that need it with a clear message.
let SC = null
try { SC = require('../../src/screenClass.json') } catch { SC = null }
const needSC = () => expect(SC, 'src/screenClass.json is missing (new module)').not.toBeNull()
// Test-only: on the code from before the change, a stylesheet rewrite maps env(safe-area-inset-*) to the same --sa-* values.
const SHIM = process.env.ARRVIEW_LEGACY_INSET_SHIM ? require(process.env.ARRVIEW_LEGACY_INSET_SHIM) : null
const SHOTS = process.env.ARRVIEW_SHOTS_DIR || null

test.use({ serviceWorkers: 'block' })
test.beforeEach(async ({ request }) => { await request.post('/__fixture/downloads', { data: { scenario: 'legacy' } }) })
test.afterEach(async ({ request }) => { await request.post('/__fixture/downloads', { data: { scenario: 'legacy' } }) })

const SIDES = ['top', 'right', 'bottom', 'left']
const insetsOf = values => Object.fromEntries(SIDES.map(side => [side, (values && values[side]) || 0]))
const TAB_NAMES = ['Downloads', 'Shows', 'Upcoming', 'Movies', 'Search']
const RAIL_NAMES = [...TAB_NAMES, 'Settings']

async function openContext(browser, size, { viewport, insets } = {}) {
  const context = await browser.newContext({ viewport: viewport || { width: size.width, height: size.height }, ignoreHTTPSErrors: true,
    serviceWorkers: 'block', hasTouch: Boolean(size.touch), isMobile: Boolean(size.touch), colorScheme: 'dark' })
  await context.addInitScript(values => {
    const apply = () => { for (const [side, value] of Object.entries(values)) document.documentElement.style.setProperty(`--sa-${side}`, `${value}px`) }
    if (document.documentElement) apply(); else document.addEventListener('DOMContentLoaded', apply)
  }, insetsOf(insets || size.insets))
  const page = await context.newPage()
  if (SHIM) await SHIM.install(page)
  return { context, page }
}
async function setInsets(page, values) {
  await page.evaluate(v => { for (const [side, value] of Object.entries(v)) document.documentElement.style.setProperty(`--sa-${side}`, `${value}px`) }, insetsOf(values))
}
const frame = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))

// The library, enlarged from the fixture's own answers so two rows of six can fill and the continuity rows can scroll.
const pad2 = n => String(n).padStart(2, '0')
async function enlarge(page, { shows = 48, movies = 48 } = {}) {
  await page.route('**/api/sonarr/series', async route => {
    const base = await (await route.fetch()).json()
    const clones = Array.from({ length: shows }, (_, i) => ({ ...base[0], id: 1001 + i, title: `Fold Fixture Show ${pad2(i + 1)}`, titleSlug: `fold-fixture-show-${i + 1}`,
      year: 1990 + i, status: i % 2 ? 'ended' : 'continuing' }))
    await route.fulfill({ json: [...base, ...clones] })
  })
  await page.route('**/api/radarr/movies', async route => {
    const base = await (await route.fetch()).json()
    const clones = Array.from({ length: movies }, (_, i) => ({ ...base[0], id: 2001 + i, title: `Fold Fixture Movie ${pad2(i + 1)}`, year: 1990 + i,
      added: new Date(Date.UTC(2026, 0, 1) - i * 86400000).toISOString() }))
    await route.fulfill({ json: [...base, ...clones] })
  })
}

const PAGES = [
  { id: 'downloads', hash: '/downloads', wait: '.m-dl-hero, .m-dl-section', first: '.m-dl-hero, .m-dl-section' },
  { id: 'shows', hash: '/shows', wait: '.m-grid li', first: '.m-grid li, .m-list li', grid: true },
  { id: 'movies', hash: '/movies', wait: '.m-grid li', first: '.m-grid li, .m-list li', grid: true },
  { id: 'upcoming', hash: '/upcoming', wait: '.m-utile, .m-ulist-row', first: '.m-utile, .m-ulist-row' },
  { id: 'show', hash: '/shows/1', wait: 'li.m-ep', detail: 'show' },
  { id: 'movie', hash: '/movies/2', wait: '.m-hero-actions', detail: 'movie' },
  { id: 'search', hash: '/search', wait: '.nzb-search-input', first: '.nzb-search-input' },
  { id: 'settings', hash: '/settings', wait: '.config-container', first: '.m-main .config-container > *' },
  { id: 'add', hash: '/shows', wait: '.m-grid li', sheet: true },
]
async function show(page, p) {
  await page.goto(`/#${p.hash}`)
  await expect(page.locator('main h1').first()).toBeAttached()
  await expect(page.locator(p.wait).first()).toBeVisible()
  if (p.sheet) {
    await page.getByRole('button', { name: 'Add Show', exact: true }).first().click()
    await expect(page.locator('dialog.sheet')).toBeVisible()
  }
  await frame(page)
}
async function closeSheet(page) {
  if (await page.locator('dialog.sheet').count()) { await page.keyboard.press('Escape'); await expect(page.locator('dialog.sheet')).toHaveCount(0) }
}

// One pass over the page in the browser: overflow, chrome, first content, column and keep-out hits, small targets, bars.
function inspect(page, { column, keepOut, first, coarse }) {
  return page.evaluate(({ column, keepOut, first, coarse }) => {
    const vw = document.documentElement.clientWidth, vh = window.innerHeight
    const shown = el => !el.checkVisibility || el.checkVisibility({ opacityProperty: true, visibilityProperty: true })
    // The part of an element's box that is not clipped by a scrolling or clipping ancestor, nor outside the viewport.
    function visible(rect, el, self = false) {
      let r = { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
      for (let a = self ? el : el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
        const s = getComputedStyle(a)
        if (s.overflowX !== 'visible' || s.overflowY !== 'visible' || s.clip !== 'auto') {
          const b = a.getBoundingClientRect()
          r = { left: Math.max(r.left, b.left), top: Math.max(r.top, b.top), right: Math.min(r.right, b.right), bottom: Math.min(r.bottom, b.bottom) }
        }
        if (s.position === 'fixed') break
      }
      r = { left: Math.max(r.left, 0), top: Math.max(r.top, 0), right: Math.min(r.right, vw), bottom: Math.min(r.bottom, vh) }
      return r.right - r.left > 0.5 && r.bottom - r.top > 0.5 ? r : null
    }
    const hits = (r, area) => r && r.left < area.right - 0.5 && r.right > area.left + 0.5 && r.top < area.bottom - 0.5 && r.bottom > area.top + 0.5
    const nameOf = el => (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || el.tagName).replace(/\s+/g, ' ').trim().slice(0, 60)
    const INTERACTIVE = 'a[href], button, input:not([type="hidden"]), select, textarea, [role="button"], [tabindex]:not([tabindex="-1"])'
    const interactive = [...document.querySelectorAll(INTERACTIVE)].filter(el => !el.closest('[hidden], [inert]') && shown(el))
      .map(el => ({ el, box: el.getBoundingClientRect(), rect: visible(el.getBoundingClientRect(), el) })).filter(item => item.rect)
    const shell = document.querySelector('.m-shell')
    const topbar = document.querySelector('.m-topbar'), bottom = document.querySelector('.m-bottomnav')
    const chromeTop = topbar ? Math.max(0, topbar.getBoundingClientRect().bottom) : 0
    const visibleBottom = bottom ? bottom.getBoundingClientRect().top : vh
    const firstEl = first ? document.querySelector(first) : null
    const out = {
      vw, vh, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth, chromeTop, visibleBottom,
      first: firstEl ? firstEl.getBoundingClientRect().top : null,
      shell: shell ? { height: shell.dataset.height || null, width: shell.dataset.width || null, nav: shell.dataset.nav || null, railSide: shell.dataset.railSide || null,
        keepOut: parseFloat(getComputedStyle(shell).getPropertyValue('--m-keepout')) || null } : null,
      rail: document.querySelector('.m-rail') ? document.querySelector('.m-rail').getBoundingClientRect().toJSON() : null,
      columnHits: [], keepOutHits: [], small: [],
    }
    if (column) {
      const area = column.side === 'right' ? { left: vw - column.width, right: vw, top: 0, bottom: vh } : { left: 0, right: column.width, top: 0, bottom: vh }
      for (const { el, rect } of interactive) if (!el.closest('.m-rail') && hits(rect, area)) out.columnHits.push(nameOf(el))
      if (keepOut) {
        const top = { ...area, bottom: keepOut }
        for (const { el, rect } of interactive) if (hits(rect, top)) out.keepOutHits.push(`control: ${nameOf(el)}`)
        for (const el of document.querySelectorAll('img, svg, video')) {
          if (el.closest('[data-m-backdrop]') || el.closest('svg') !== el || !shown(el)) continue
          if (hits(visible(el.getBoundingClientRect(), el), top)) out.keepOutHits.push(`image: ${el.tagName.toLowerCase()} ${el.getAttribute('class') || ''}`.trim())
        }
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const parent = node.parentElement
          if (!node.textContent.trim() || !parent || parent.closest('.m-sr, script, style, [hidden]') || !shown(parent)) continue
          const range = document.createRange(); range.selectNodeContents(node)
          for (const r of range.getClientRects()) if (hits(visible(r, parent, true), top)) { out.keepOutHits.push(`text: ${node.textContent.trim().slice(0, 40)}`); break }
        }
      }
    }
    if (coarse) for (const { el, box } of interactive) {
      // Regression anchors only: the top bar's brand link and live pill are under 44 px tall at acf02d6 on touch iPads, and the
      // regular-height layout must not change (brief rule 3), so the regression guard leaves those two out.
      if (coarse === 'regression' && el.closest('.m-topbar') && (el.matches('.m-brand') || el.matches('.m-live-pill'))) continue
      if (box.width < 43.9 || box.height < 43.9) out.small.push(`${nameOf(el)} (${Math.round(box.width)} x ${Math.round(box.height)})`)
    }
    return out
  }, { column, keepOut, first, coarse })
}

// The keep-out of the Phase 0 notes: a share of the (large) height that shrinks so the rail fits below it.
// "ios" (two pills, note 2): the tab pill ends `bottomMargin` above the viewport bottom, the top pill (Back on detail pages,
// then Settings) sits a gap above it; never below the minimum. "labelled" (note 1): the one rail group above --sa-bottom.
const railStyleAt = size => (size.expected.nav === 'rail' && size.expected.column && SC.railPlacement === 'inside' ? SC.railStyle : 'labelled')
function keepOutFor(size, { detail = false, tabs = TAB_NAMES.length } = {}) {
  const H = size.height, tight = H < SC.iconsOnlyBelow, ratio = Math.round(SC.statusKeepOutRatio * H)
  if (railStyleAt(size) === 'ios') {
    const k = SC.ios, pitch = tight ? k.pitchTight : k.pitch, padding = tight ? k.padTight : k.pad, gap = tight ? k.gapTight : k.gap
    const tabTop = H - k.bottomMargin - (tabs * pitch + 2 * padding)
    const fit = tabTop - gap - ((detail ? 2 : 1) * pitch + 2 * padding)
    return Math.max(SC.statusKeepOutMin, Math.min(ratio, fit))
  }
  const k = SC.labelled, items = tabs + 1
  const stack = items * (tight ? k.itemIconsOnly : k.item) + (items - 1) * k.gap
  const room = H - inset(size, 'bottom') - k.pad - stack
  return Math.max(0, Math.min(Math.max(SC.statusKeepOutMin, ratio), room))
}
const columnOf = size => size.expected.column ? { side: size.expected.column, width: inset(size, size.expected.column) } : null

// Criterion 27: show and movie pages on short screens.
async function detailChecks(page, size, kind) {
  const r = await page.evaluate(kind => {
    const box = sel => { const el = document.querySelector(sel); return el ? el.getBoundingClientRect().toJSON() : null }
    const hero = document.querySelector('.m-hero')
    return { vh: innerHeight, minHeight: hero ? parseFloat(getComputedStyle(hero).minHeight) || 0 : null,
      bottomBar: document.querySelector('.m-bottomnav') ? document.querySelector('.m-bottomnav').getBoundingClientRect().top : innerHeight,
      seasonBar: box('.m-season-bar'), episode: box('li.m-ep'), title: box('.m-hero-body h1'), actions: box('.m-hero-actions'),
      back: box('.m-back'), settings: box('.m-hero-nav .m-roundbtn'), vw: document.documentElement.clientWidth }
  }, kind)
  expect.soft(r.minHeight, `${size.id} ${kind}: hero min-height`).toBeLessThanOrEqual(0.55 * r.vh + 0.5)
  if (kind === 'show') {
    expect.soft(r.seasonBar && r.seasonBar.top, `${size.id} show: season bar starts in the first screen`).toBeLessThan(r.bottomBar)
    expect.soft(r.episode && r.episode.top, `${size.id} show: first episode starts in the first screen`).toBeLessThan(r.bottomBar)
  } else {
    expect.soft(r.title && r.title.top, `${size.id} movie: title starts in the first screen`).toBeLessThan(r.bottomBar)
    expect.soft(r.actions && r.actions.top, `${size.id} movie: actions start in the first screen`).toBeLessThan(r.bottomBar)
  }
  const column = columnOf(size)
  if (column && size.width < 640) for (const [name, b] of [['Back', r.back], ['Settings', r.settings]]) {
    if (!b) continue
    const inColumn = column.side === 'right' ? b.right > r.vw - column.width + 0.5 : b.left < column.width - 0.5
    expect.soft(inColumn, `${size.id} ${kind}: ${name} stays out of the column`).toBe(false)
  }
}

// Criterion 23: two full rows of large posters at scroll 0, 3 columns compact, 6 regular; small and list views fit.
async function gridChecks(page, size, p) {
  const r = await page.evaluate(() => {
    const tiles = [...document.querySelectorAll('.m-grid.is-large > li')].map(li => li.getBoundingClientRect())
    const bottomBar = document.querySelector('.m-bottomnav') ? document.querySelector('.m-bottomnav').getBoundingClientRect().top : innerHeight
    const cols = tiles.filter(t => Math.abs(t.top - tiles[0].top) < 1).length
    return { cols, count: tiles.length, rowTwoBottom: tiles[2 * cols - 1] ? Math.max(...tiles.slice(cols, 2 * cols).map(t => t.bottom)) : null, bottomBar }
  })
  expect.soft(r.cols, `${size.id} ${p.id}: large-poster columns`).toBe(size.width < 640 ? 3 : 6)
  expect.soft(r.rowTwoBottom, `${size.id} ${p.id}: the second row of large posters is fully visible at scroll 0`).not.toBeNull()
  if (r.rowTwoBottom !== null) expect.soft(r.rowTwoBottom, `${size.id} ${p.id}: second row bottom`).toBeLessThanOrEqual(r.bottomBar + 0.5)
  for (const view of ['Small posters', 'List']) {
    await page.getByRole('group', { name: 'View' }).getByRole('button', { name: view }).click()
    await frame(page)
    expect.soft(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${size.id} ${p.id}: ${view} fits`).toBe(true)
  }
  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Large posters' }).click()
}

// Assertions 1 to 5 at one size, every page.
async function checkSize(browser, size) {
  const { context, page } = await openContext(browser, size)
  await enlarge(page)
  const column = columnOf(size)
  const short = size.expected.height === 'short'
  for (const p of PAGES) {
    await show(page, p)
    const keepOut = column && SC ? keepOutFor(size, { detail: Boolean(p.detail) }) : null
    // Regular-height sizes keep the acf02d6 layout (brief rule 3), so they get the regression guard's exemptions.
    const r = await inspect(page, { column, keepOut, first: p.first, coarse: size.touch && (short ? true : 'regression') })
    expect.soft(r.overflow, `${size.id} ${p.id}: horizontal overflow`).toBe(false)
    expect.soft(r.shell && r.shell.nav, `${size.id} ${p.id}: navigation`).toBe(size.expected.nav)
    expect.soft(r.shell && r.shell.height, `${size.id} ${p.id}: height class`).toBe(size.expected.height)
    if (size.expected.nav === 'rail') {
      expect.soft(r.shell && r.shell.railSide, `${size.id} ${p.id}: rail side`).toBe(size.expected.column || 'left')
      const ios = SC && railStyleAt(size) === 'ios'
      const names = await page.getByRole('navigation', { name: 'Main navigation' }).locator('a').evaluateAll(els => els.map(el => el.getAttribute('aria-label') || el.textContent.trim()))
      expect.soft(names, `${size.id} ${p.id}: rail links`).toEqual(ios ? TAB_NAMES : RAIL_NAMES)
    }
    if (size.expected.nav === 'top' && inset(size, 'top')) {
      // The top bar clears the top inset (maintainer note 3: 669 x 951 with top 82).
      const bar = await page.evaluate(() => { const b = document.querySelector('.m-topbar'); if (!b) return null; const link = b.querySelector('a').getBoundingClientRect(); return { height: b.getBoundingClientRect().height, link: link.top } })
      expect.soft(bar && bar.height, `${size.id} ${p.id}: top bar height`).toBe(56 + inset(size, 'top'))
      expect.soft(bar && bar.link, `${size.id} ${p.id}: top bar content below the top inset`).toBeGreaterThanOrEqual(inset(size, 'top'))
    }
    if (size.expected.nav === 'rail' || size.expected.nav === 'top') {
      await expect.soft(page.getByRole('link', { name: 'Settings', exact: true }), `${size.id} ${p.id}: one visible Settings link`).toHaveCount(1)
    }
    if (short && p.first) {
      expect.soft(r.first, `${size.id} ${p.id}: first content (${p.first})`).not.toBeNull()
      expect.soft(r.first, `${size.id} ${p.id}: first content within the top 25%`).toBeLessThanOrEqual(0.25 * r.vh + 0.5)
    }
    if (short && p.detail) await detailChecks(page, size, p.detail)
    if (size.twoRows && p.grid) await gridChecks(page, size, p)
    if (column) {
      expect.soft(r.columnHits, `${size.id} ${p.id}: controls outside the rail inside the ${column.side} column`).toEqual([])
      needSC()
      expect.soft(r.shell && r.shell.keepOut, `${size.id} ${p.id}: the shell's --m-keepout`).toBe(keepOut)
      expect.soft(r.keepOutHits, `${size.id} ${p.id}: nothing in the column's top ${keepOut} px`).toEqual([])
    }
    if (size.touch) expect.soft(r.small, `${size.id} ${p.id}: coarse-pointer targets under 44 x 44`).toEqual([])
    await closeSheet(page)
  }
  await context.close()
}

test.describe('foldables: size matrix', () => {
  for (const size of SIZES) {
    test(`${size.id} ${size.width} x ${size.height}: no overflow, first content, column, keep-out and targets (assertions 1-5)`, async ({ browser }) => {
      test.setTimeout(180000)
      await checkSize(browser, size)
    })
  }
  for (const size of REGRESSION) {
    test(`regression guard ${size.id} ${size.width} x ${size.height}: no overflow and 44 px targets (assertions 1, 5)`, async ({ browser }) => {
      test.setTimeout(180000)
      const { context, page } = await openContext(browser, size)
      await enlarge(page)
      for (const p of PAGES) {
        await show(page, p)
        const r = await inspect(page, { coarse: size.touch ? 'regression' : false })
        expect.soft(r.overflow, `${size.id} ${p.id}: horizontal overflow`).toBe(false)
        if (size.touch) expect.soft(r.small, `${size.id} ${p.id}: coarse-pointer targets under 44 x 44`).toEqual([])
        await closeSheet(page)
      }
      await context.close()
    })
    test(`regression guard ${size.id} ${size.width} x ${size.height}: no rail, bars as before (assertion 8)`, async ({ browser }) => {
      const { context, page } = await openContext(browser, size)
      await show(page, PAGES[1])
      await expect(page.locator('.m-rail')).toHaveCount(0)
      const nav = page.getByRole('navigation', { name: 'Main navigation' })
      await expect(nav).toHaveCount(1)
      const box = await nav.boundingBox()
      if (size.width < 640) {
        await expect(page.locator('.m-topbar')).toHaveCount(0)
        const bar = await page.locator('.m-bottomnav').boundingBox()
        expect(bar).toEqual({ x: 0, y: size.height - 56 - inset(size, 'bottom'), width: size.width, height: 56 + inset(size, 'bottom') })
        expect(box).toEqual(bar)
        await expect(nav.getByRole('link')).toHaveText(TAB_NAMES)
      } else {
        await expect(page.locator('.m-bottomnav')).toHaveCount(0)
        const bar = page.locator('.m-topbar')
        expect(await bar.boundingBox()).toEqual({ x: 0, y: 0, width: size.width, height: 56 + inset(size, 'top') })
        await expect(bar.getByRole('link', { name: 'ArrView' })).toBeVisible()
        await expect(nav.getByRole('link')).toHaveText(TAB_NAMES)
        await expect(bar.locator('.m-live-pill')).toHaveCount(1)
        await expect(bar.getByRole('link', { name: 'Settings', exact: true })).toBeVisible()
      }
      await context.close()
    })
  }
})

// Criteria 17 to 20: the rail and the compact bar.
test.describe('foldables: navigation', () => {
  // The labelled rail: the one style outside a side-controls column (here the left rail of a short coarse screen).
  test('the labelled rail holds the five content tabs then Settings, with icons, labels, aria-current and the live ring; it replaces both bars (criteria 14, 15, 17-19)', async ({ browser }) => {
    const size = SIZES.find(s => s.id === 'duo-inner-land-safari')
    const { context, page } = await openContext(browser, size)
    await show(page, PAGES[1])
    await expect(page.locator('.m-shell')).toHaveAttribute('data-rail-style', 'labelled')
    const rail = page.locator('.m-rail nav')
    await expect(rail).toHaveAttribute('aria-label', 'Main navigation')
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toHaveCount(1)
    await expect(rail.getByRole('link')).toHaveText(RAIL_NAMES)
    await expect(rail.getByRole('link', { name: 'Shows' })).toHaveAttribute('aria-current', 'page')
    expect(await rail.locator('a svg').count()).toBeGreaterThanOrEqual(RAIL_NAMES.length)
    expect(await page.locator('.m-rail img, .m-rail .m-brand').count()).toBe(0)
    await expect(page.locator('.m-topbar, .m-bottomnav')).toHaveCount(0)
    // One visible Settings entry: the rail's.
    for (const hash of ['/shows', '/downloads', '/shows/1', '/movies/2', '/upcoming']) {
      await page.goto(`/#${hash}`); await frame(page)
      await expect(page.getByRole('link', { name: 'Settings', exact: true }), hash).toHaveCount(1)
      await expect(rail.getByRole('link', { name: 'Settings', exact: true })).toBeVisible()
    }
    await page.goto('/#/shows'); await frame(page)
    // Live downloads: the legacy fixture is downloading, so the ring shows on the Downloads item and its name stays.
    const downloads = rail.getByRole('link', { name: 'Downloads', exact: true })
    await expect(downloads.getByRole('progressbar', { name: 'Download progress' })).toBeVisible()
    for (const box of await rail.getByRole('link').evaluateAll(els => els.map(el => el.getBoundingClientRect().toJSON()))) {
      expect(box.width).toBeGreaterThanOrEqual(43.9); expect(box.height).toBeGreaterThanOrEqual(43.9)
    }
    // Labels are 10-11 px under each icon.
    const label = await rail.getByRole('link', { name: 'Shows' }).evaluate(el => {
      const text = [...el.querySelectorAll('span')].find(s => s.textContent === 'Shows'), icon = el.querySelector('svg')
      return { size: parseFloat(getComputedStyle(text).fontSize), below: text.getBoundingClientRect().top >= icon.getBoundingClientRect().bottom - 1 }
    })
    expect(label.size).toBeGreaterThanOrEqual(10); expect(label.size).toBeLessThanOrEqual(11); expect(label.below).toBe(true)
    // Opaque, 72 px at the left edge beside the (zero) left inset, anchored to the bottom above --sa-bottom; content beside it.
    const geo = await page.evaluate(() => {
      const rail = document.querySelector('.m-rail'), main = document.querySelector('.m-main'), links = [...rail.querySelectorAll('a')].map(a => a.getBoundingClientRect())
      return { rail: rail.getBoundingClientRect().toJSON(), content: main.getBoundingClientRect().left + parseFloat(getComputedStyle(main).paddingLeft),
        bg: getComputedStyle(rail).backgroundColor, lastBottom: Math.max(...links.map(r => r.bottom)), vh: innerHeight }
    })
    expect(geo.bg).toBe('rgb(11, 11, 12)')
    expect(geo.rail.width).toBeCloseTo(SC.railWidth, 0); expect(geo.rail.left).toBeCloseTo(0, 0)
    expect(geo.content).toBeGreaterThanOrEqual(geo.rail.right)
    expect(geo.lastBottom).toBeLessThanOrEqual(geo.vh - inset(size, 'bottom') + 0.5)
    await context.close()
  })
  test('below 520 px of height the labelled rail shows icons only and each item keeps its name (criterion 14)', async ({ browser }) => {
    const size = SIZES.find(s => s.id === 'duo-cover-land-safari')
    const { context, page } = await openContext(browser, size)
    await show(page, PAGES[1])
    const rail = page.locator('.m-rail nav')
    await expect(page.locator('.m-shell')).toHaveAttribute('data-rail-labels', 'off')
    for (const name of RAIL_NAMES) await expect(rail.getByRole('link', { name, exact: true })).toHaveAttribute('aria-label', name)
    expect(await rail.locator('a').evaluateAll(els => els.map(el => el.innerText.trim()).filter(Boolean))).toEqual([])
    await context.close()
  })
  // The "ios" rail inside a side-controls column (maintainer note 2): a top pill (Back, Settings) and a tab pill (icons only).
  const pills = page => page.evaluate(() => {
    const top = document.querySelector('.m-rail-pill.is-top'), tabs = document.querySelector('.m-rail-pill.is-tabs')
    const probe = document.createElement('div'); probe.style.background = 'var(--raised)'; document.body.append(probe)
    const raised = getComputedStyle(probe).backgroundColor; probe.remove()
    const box = el => el ? el.getBoundingClientRect().toJSON() : null
    return { vw: document.documentElement.clientWidth, vh: innerHeight, top: box(top), tabs: box(tabs), raised,
      topBg: top && getComputedStyle(top).backgroundColor, tabsBg: tabs && getComputedStyle(tabs).backgroundColor,
      topLinks: top ? [...top.querySelectorAll('a')].map(a => a.getAttribute('aria-label')) : [],
      links: [...document.querySelectorAll('.m-rail a')].map(a => a.getBoundingClientRect().toJSON()),
      keepOut: parseFloat(getComputedStyle(document.querySelector('.m-shell')).getPropertyValue('--m-keepout')) }
  })
  test('the ios rail: two opaque pills centred in the column, icons-only tabs with names, Back above Settings on detail pages (note 2 item 1)', async ({ browser }) => {
    test.skip(Boolean(SC) && SC.railStyle !== 'ios', 'the e2e matrix runs on the default rail style')
    needSC()
    const { context, page } = await openContext(browser, FOLD.cover)
    await show(page, PAGES[1])
    await expect(page.locator('.m-shell')).toHaveAttribute('data-rail-style', 'ios')
    const nav = page.getByRole('navigation', { name: 'Main navigation' })
    await expect(nav).toHaveCount(1)
    await expect(nav.getByRole('link')).toHaveCount(TAB_NAMES.length)
    expect(await nav.locator('a').evaluateAll(els => els.map(el => el.innerText.trim()).filter(Boolean))).toEqual([])
    for (const name of TAB_NAMES) {
      const link = nav.getByRole('link', { name, exact: true })
      await expect(link).toHaveAttribute('aria-label', name); await expect(link).toHaveAttribute('title', name)
    }
    const active = nav.getByRole('link', { name: 'Shows' })
    await expect(active).toHaveAttribute('aria-current', 'page')
    const highlight = await active.evaluate(el => getComputedStyle(el.querySelector('.m-pilltab-icon')).backgroundColor)
    const idle = await nav.getByRole('link', { name: 'Movies' }).evaluate(el => getComputedStyle(el.querySelector('.m-pilltab-icon')).backgroundColor)
    expect(highlight).not.toBe('rgba(0, 0, 0, 0)'); expect(idle).toBe('rgba(0, 0, 0, 0)')
    await expect(nav.getByRole('link', { name: 'Downloads', exact: true }).getByRole('progressbar', { name: 'Download progress' })).toBeVisible()
    let r = await pills(page)
    expect(r.topLinks).toEqual(['Settings'])
    for (const pill of [r.top, r.tabs]) {
      expect(pill.width).toBeGreaterThanOrEqual(52); expect(pill.width).toBeLessThanOrEqual(56)
      expect(pill.left + pill.width / 2).toBeCloseTo(r.vw - 84 / 2, 0)
    }
    expect(r.topBg).toBe(r.raised); expect(r.tabsBg).toBe(r.raised)
    expect(r.tabs.bottom).toBeCloseTo(r.vh - SC.ios.bottomMargin, 0)
    expect(r.top.top).toBeCloseTo(r.keepOut, 0)
    expect(r.tabs.top - r.top.bottom).toBeGreaterThanOrEqual(SC.ios.gap - 0.5)
    for (const box of r.links) { expect(box.width).toBeGreaterThanOrEqual(43.9); expect(box.height).toBeGreaterThanOrEqual(43.9) }
    await expect(page.getByRole('link', { name: 'Settings', exact: true })).toHaveCount(1)
    // Detail pages: Back moves into the top pill; the hero's round Back and Settings and the header gear are not rendered.
    await show(page, PAGES[4])
    r = await pills(page)
    expect(r.topLinks).toEqual(['Back to TV Shows', 'Settings'])
    await expect(page.locator('.m-hero-nav')).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Back to TV Shows' })).toHaveCount(1)
    await expect(page.getByRole('link', { name: 'Settings', exact: true })).toHaveCount(1)
    await show(page, PAGES[5])
    expect((await pills(page)).topLinks).toEqual(['Back to Movies', 'Settings'])
    // The page's own actions stay in the page header.
    await show(page, PAGES[2])
    await expect(page.locator('.m-pageheader').getByRole('button', { name: 'Add Movie' })).toBeVisible()
    await expect(page.locator('.m-pageheader').getByRole('group', { name: 'View' })).toBeVisible()
    await context.close()
  })
  for (const [id, expected] of [['duo-inner-land', { top: [254, 366], tabs: [389, 645] }], ['duo-cover-land-left', { top: [97, 197], tabs: [205, 437] }]]) {
    test(`the ios rail matches the worked example on a show page at ${id} (note 2 item 2)`, async ({ browser }) => {
      test.skip(Boolean(SC) && SC.railStyle !== 'ios', 'the e2e matrix runs on the default rail style')
      needSC()
      const size = SIZES.find(s => s.id === id)
      const { context, page } = await openContext(browser, size)
      await show(page, PAGES[4])
      const r = await pills(page)
      expect([Math.round(r.top.top), Math.round(r.top.bottom)]).toEqual(expected.top)
      expect([Math.round(r.tabs.top), Math.round(r.tabs.bottom)]).toEqual(expected.tabs)
      expect(r.keepOut).toBeGreaterThanOrEqual(SC.statusKeepOutMin)
      for (const box of r.links) { expect(box.width).toBeGreaterThanOrEqual(43.9); expect(box.height).toBeGreaterThanOrEqual(43.9) }
      const side = size.expected.column
      for (const pill of [r.top, r.tabs]) {
        const centre = side === 'right' ? r.vw - inset(size, 'right') / 2 : inset(size, 'left') / 2
        expect(pill.left + pill.width / 2).toBeCloseTo(centre, 0)
      }
      await context.close()
    })
  }
  test('toasts sit over the content, clear of the column (note 2 item 3; criterion 19)', async ({ browser }) => {
    const { context, page } = await openContext(browser, FOLD.cover)
    await show(page, PAGES[4])
    await page.getByRole('button', { name: 'Search Missing' }).first().click()
    const toast = page.locator('.toast').first()
    await expect(toast).toBeVisible()
    await page.waitForTimeout(500) // the slide-in animation
    const r = await toast.evaluate(el => ({ box: el.getBoundingClientRect().toJSON(), vw: document.documentElement.clientWidth, vh: innerHeight }))
    expect(r.box.right).toBeLessThanOrEqual(r.vw - inset(FOLD.cover, 'right') + 0.5)
    expect(r.box.bottom).toBeLessThanOrEqual(r.vh - inset(FOLD.cover, 'bottom') + 0.5)
    await context.close()
  })
  test('the compact bottom bar: 48 px plus the bottom inset, five tabs with 9-10 px labels, Settings stays the header gear (criterion 20)', async ({ browser }) => {
    const size = SIZES.find(s => s.id === 'iphone-se')
    const { context, page } = await openContext(browser, size, { insets: { bottom: 20 } })
    await show(page, PAGES[1])
    await expect(page.locator('.m-shell')).toHaveAttribute('data-nav', 'bottom-compact')
    const bar = page.locator('.m-bottomnav')
    expect(await bar.boundingBox()).toEqual({ x: 0, y: size.height - 68, width: size.width, height: 68 })
    await expect(bar.getByRole('link')).toHaveText(TAB_NAMES)
    const sizes = await bar.locator('a span').evaluateAll(els => els.map(el => parseFloat(getComputedStyle(el).fontSize)))
    for (const px of sizes) { expect(px).toBeGreaterThanOrEqual(9); expect(px).toBeLessThanOrEqual(10) }
    expect(await bar.evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgb(11, 11, 12)')
    await expect(page.locator('main').getByRole('link', { name: 'Settings', exact: true })).toBeVisible()
    await context.close()
  })
  test('a short fine-pointer window keeps the top bar and condenses the headers (criteria 5, 21)', async ({ browser }) => {
    const size = SIZES.find(s => s.id === 'desktop-short')
    const { context, page } = await openContext(browser, size)
    await enlarge(page)
    await show(page, PAGES[1])
    await expect(page.locator('.m-topbar')).toBeVisible()
    const header = page.locator('.m-pageheader')
    await expect(header).toHaveClass(/is-condensed/)
    await expect(header.getByRole('textbox', { name: 'Search shows' })).toBeVisible()
    const title = await header.locator('h1').evaluate(el => parseFloat(getComputedStyle(el).fontSize))
    expect(title).toBeGreaterThanOrEqual(20); expect(title).toBeLessThanOrEqual(22)
    await context.close()
  })
  test('condensed headers: one title row and one toolbar row that never wraps; compact search starts as an icon button (criterion 21)', async ({ browser }) => {
    const { context, page } = await openContext(browser, FOLD.cover)
    await enlarge(page)
    await page.addInitScript(() => { if (!sessionStorage.getItem('fold-init')) { localStorage.removeItem('arrview.ui.v1.movies.search'); sessionStorage.setItem('fold-init', '1') } })
    await show(page, PAGES[2])
    const header = page.locator('.m-pageheader.is-condensed')
    await expect(header.locator('.m-titlerow h1')).toHaveText('Movies')
    await expect(header.locator('.m-titlerow').getByRole('button', { name: 'Add Movie' })).toBeVisible()
    await expect(header.locator('.m-titlerow').getByRole('group', { name: 'View' })).toBeVisible()
    const toolbar = header.locator('.m-toolbar')
    const tops = await toolbar.locator(':scope > *').evaluateAll(els => els.map(el => Math.round(el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2)))
    expect(new Set(tops).size).toBe(1)
    await expect(toolbar.getByRole('button', { name: /Download All Missing/ })).toBeAttached()
    await expect(toolbar.getByRole('textbox', { name: 'Search movies' })).toHaveCount(0)
    await toolbar.getByRole('button', { name: 'Search movies' }).click()
    await expect(toolbar.getByRole('textbox', { name: 'Search movies' })).toBeFocused()
    await page.keyboard.type('Fold')
    await page.reload(); await expect(page.locator('.m-grid li').first()).toBeVisible()
    await expect(page.locator('.m-toolbar').getByRole('textbox', { name: 'Search movies' })).toHaveValue('Fold')
    await context.close()
  })
})

// Criterion 8 (B1): the Downloads fanart hero has artwork on phone widths; poster and glyph heroes keep their geometry.
test.describe('foldables: Downloads hero', () => {
  for (const size of [{ id: 'phone-393', width: 393, height: 852, insets: {}, touch: true }, FOLD.cover]) {
    test(`B1: the fanart hero art box is wider and taller than 0 at ${size.width} x ${size.height}`, async ({ browser, request }) => {
      await request.post('/__fixture/downloads', { data: { scenario: 'rich' } })
      const { context, page } = await openContext(browser, size)
      await page.goto('/#/downloads')
      const art = page.locator('.m-dl-hero.is-fanart .m-hero-art')
      await expect(art).toBeAttached()
      const box = await art.evaluate(el => el.getBoundingClientRect().toJSON())
      expect(box.width).toBeGreaterThan(0); expect(box.height).toBeGreaterThan(0)
      await context.close()
    })
  }
  for (const [width, height] of [[402, 874], [1280, 800]]) {
    test(`B1 regression guard: poster and glyph heroes keep their geometry at ${width} x ${height}`, async ({ browser, request }) => {
      const size = { width, height, insets: {}, touch: width < 640 }
      const { context, page } = await openContext(browser, size)
      await page.goto('/#/downloads')
      const glyph = await page.locator('.m-dl-hero.is-glyph .m-dl-hero-poster').evaluate(el => ({ box: el.getBoundingClientRect().toJSON(), hero: el.closest('.m-dl-hero').getBoundingClientRect().toJSON() }))
      if (width < 640) { expect(glyph.box.width).toBeCloseTo(Math.min(200, 0.55 * glyph.hero.width), 0); expect(glyph.box.left - glyph.hero.left).toBeCloseTo(glyph.hero.right - glyph.box.right, 0) }
      else { expect(glyph.box.width).toBeCloseTo(200, 0); expect(glyph.box.left).toBeCloseTo(glyph.hero.left, 0) }
      await context.close()
      await request.post('/__fixture/downloads', { data: { scenario: 'rich' } })
      const second = await openContext(browser, size)
      await second.page.route('**/api/sonarr/queue**', async route => {
        const body = await (await route.fetch()).json()
        const strip = value => JSON.parse(JSON.stringify(value, (key, v) => key === 'images' && Array.isArray(v) ? v.filter(i => i.coverType === 'poster') : v))
        await route.fulfill({ json: strip(body) })
      })
      await second.page.route('**/api/sonarr/series', async route => {
        const body = await (await route.fetch()).json()
        await route.fulfill({ json: body.map(s => ({ ...s, images: (s.images || []).filter(i => i.coverType === 'poster') })) })
      })
      await second.page.goto('/#/downloads')
      const poster = await second.page.locator('.m-dl-hero.is-poster .m-dl-hero-poster').evaluate(el => ({ box: el.getBoundingClientRect().toJSON(), hero: el.closest('.m-dl-hero').getBoundingClientRect().toJSON() }))
      if (width < 640) expect(poster.box.width).toBeCloseTo(Math.min(200, 0.55 * poster.hero.width), 0)
      else expect(poster.box.width).toBeCloseTo(200, 0)
      await second.context.close()
    })
  }
  for (const size of [FOLD.cover, FOLD.inner]) {
    test(`the Downloads hero on a short screen: at most 40% of the height, title clamp, Queue on the first screen (${size.id}, criterion 24)`, async ({ browser, request }) => {
      await request.post('/__fixture/downloads', { data: { scenario: 'rich' } })
      const { context, page } = await openContext(browser, size)
      await page.goto('/#/downloads')
      await expect(page.locator('.m-dl-hero.is-fanart')).toBeVisible()
      const r = await page.evaluate(() => {
        const hero = document.querySelector('.m-dl-hero').getBoundingClientRect(), queue = [...document.querySelectorAll('.m-dl-section h2')].find(h => h.textContent === 'Queue')
        const art = document.querySelector('.m-dl-hero .m-hero-art'), body = document.querySelector('.m-dl-hero-body')
        return { vh: innerHeight, hero: hero.height, queue: queue.getBoundingClientRect().top, title: parseFloat(getComputedStyle(document.querySelector('.m-dl-title')).fontSize),
          art: art.getBoundingClientRect().toJSON(), body: body.getBoundingClientRect().toJSON(), backdrop: art.hasAttribute('data-m-backdrop') }
      })
      expect(r.hero).toBeLessThanOrEqual(0.4 * r.vh + 0.5)
      expect(r.queue).toBeLessThan(r.vh)
      expect(r.title).toBeGreaterThanOrEqual(20); expect(r.title).toBeLessThanOrEqual(32)
      expect(r.backdrop).toBe(true)
      if (size.width < 640) expect(r.art.top).toBeLessThanOrEqual(r.body.top + 1) // a banner behind the title
      else expect(r.art.left).toBeGreaterThanOrEqual(r.body.right - 1) // beside the text
      await context.close()
    })
  }
})

// Criteria 9 (B2), 10-11 (B3), 34 and assertion 6: sheets inside the insets, actions in the header, keyboard-safe.
async function openSheet(page, kind) {
  if (kind === 'add') { await show(page, PAGES[1]); await page.getByRole('button', { name: 'Add Show', exact: true }).first().click() }
  if (kind === 'release') { await show(page, PAGES[5]); await page.getByRole('button', { name: 'Interactive Search' }).click() }
  if (kind === 'confirm') { await page.goto('/#/downloads'); await page.getByRole('button', { name: 'Remove from SABnzbd Queue' }).first().click() }
  if (kind === 'nzb') {
    await page.goto('/'); await page.evaluate(() => localStorage.setItem('arrview.ui.v1.layout', '"classic"')); await page.reload()
    const tab = page.getByRole('button', { name: 'Downloads', exact: true }); if (await tab.count()) await tab.first().click()
    await page.getByRole('button', { name: /Search NZBs/ }).click()
  }
  await expect(page.locator('dialog.sheet')).toBeVisible()
  await frame(page)
}
test.describe('foldables: sheets', () => {
  for (const size of [FOLD.inner, FOLD.cover]) {
    for (const kind of ['add', 'nzb', 'release', 'confirm']) {
      test(`B2: the ${kind} sheet stays inside the insets and its Close button out of the column (${size.id})`, async ({ browser }) => {
        const { context, page } = await openContext(browser, size)
        await openSheet(page, kind)
        const r = await page.evaluate(() => ({ vw: document.documentElement.clientWidth, sheet: document.querySelector('dialog.sheet').getBoundingClientRect().toJSON(),
          close: document.querySelector('dialog.sheet [aria-label="Close dialog"]').getBoundingClientRect().toJSON() }))
        expect(r.sheet.left).toBeGreaterThanOrEqual(inset(size, 'left') - 0.5)
        expect(r.sheet.right).toBeLessThanOrEqual(r.vw - inset(size, 'right') + 0.5)
        expect(r.sheet.top).toBeGreaterThanOrEqual(inset(size, 'top') - 0.5)
        expect(r.close.right).toBeLessThanOrEqual(r.vw - inset(size, 'right') + 0.5)
        await context.close()
      })
    }
  }
  test('B3: on a short screen the Add sheet shows Close, the title and Add Show in its header and no footer (criterion 10)', async ({ browser }) => {
    const { context, page } = await openContext(browser, FOLD.inner)
    await openSheet(page, 'add')
    const dialog = page.locator('dialog.sheet')
    const order = await dialog.locator('.sheet-header').evaluate(el => [...el.children].map(c => c.tagName === 'H2' ? 'title' : c.getAttribute('aria-label') || c.textContent.trim()))
    expect(order).toEqual(['Close dialog', 'title', 'Add Show'])
    await expect(dialog.locator('.add-footer')).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: 'Add Show', exact: true })).toBeDisabled()
    await context.close()
  })
  test('B3 regression guard: on a regular-height screen the Add sheet keeps its footer (criterion 10)', async ({ browser }) => {
    const { context, page } = await openContext(browser, REGRESSION.find(s => s.id === 'desktop'))
    await openSheet(page, 'add')
    const dialog = page.locator('dialog.sheet')
    await expect(dialog.locator('.add-footer').getByRole('button', { name: 'Cancel' })).toBeVisible()
    await expect(dialog.locator('.add-footer').getByRole('button', { name: 'Add Show', exact: true })).toBeVisible()
    await context.close()
  })
  for (const size of KEYBOARD) {
    for (const kind of ['add', 'nzb']) {
      const primary = kind === 'add' ? 'Add Show' : null
      test(`assertion 6, viewport cut to ${size.width} x ${size.height}: the ${kind} sheet's field, Close${primary ? ' and Add Show' : ''} are inside it (${size.id})`, async ({ browser }) => {
        const { context, page } = await openContext(browser, size)
        await openSheet(page, kind)
        await expectKeyboardSafe(page, 0, size.height, primary)
        await context.close()
      })
      test(`assertion 6, keyboard over ${size.full.width} x ${size.full.height}: the ${kind} sheet fits the ${size.height} px visual viewport at offsetTop ${size.offsetTop || 0} (${size.id})`, async ({ browser }) => {
        const { context, page } = await openContext(browser, size, { viewport: size.full, insets: size.fullInsets })
        await openSheet(page, kind)
        await page.locator('dialog.sheet input[type="text"]').first().focus()
        const offsetTop = size.offsetTop || 0
        await page.evaluate(({ height, offsetTop }) => {
          const vv = window.visualViewport
          Object.defineProperty(vv, 'height', { configurable: true, get: () => height })
          Object.defineProperty(vv, 'offsetTop', { configurable: true, get: () => offsetTop })
          vv.dispatchEvent(new Event('resize'))
          vv.dispatchEvent(new Event('scroll'))
        }, { height: size.height, offsetTop })
        await frame(page)
        await expectKeyboardSafe(page, offsetTop, size.height, primary)
        // The keyboard does not change the screen class (criterion 11; the Phase 0 note).
        if (kind === 'add') await expect(page.locator('.m-shell')).toHaveAttribute('data-height', 'short')
        await context.close()
      })
    }
  }
})
// Inside the visual viewport: from offsetTop to offsetTop + height (maintainer note 3 item 2).
async function expectKeyboardSafe(page, offsetTop, visibleHeight, primary) {
  const dialog = page.locator('dialog.sheet')
  const inside = async (locator, name) => {
    const box = await locator.boundingBox()
    expect(box, name).not.toBeNull()
    expect(box.y, `${name} top`).toBeGreaterThanOrEqual(offsetTop - 0.5)
    expect(box.y + box.height, `${name} bottom`).toBeLessThanOrEqual(offsetTop + visibleHeight + 0.5)
  }
  await inside(dialog.locator('input[type="text"]').first(), 'the field')
  await inside(dialog.getByRole('button', { name: 'Close dialog' }), 'Close')
  if (primary) await inside(dialog.getByRole('button', { name: primary, exact: true }), primary)
}

// Criteria 31-32b: folding and unfolding keeps the page. One test per row of the continuity matrix.
function anchorsIn(page, { rows = false } = {}) {
  return page.evaluate(rows => {
    const top = document.querySelector('.m-topbar') ? Math.max(0, document.querySelector('.m-topbar').getBoundingClientRect().bottom) : 0
    const bottom = document.querySelector('.m-bottomnav') ? document.querySelector('.m-bottomnav').getBoundingClientRect().top : innerHeight
    return [...document.querySelectorAll('.m-main [data-m-anchor]')].map(el => ({ key: el.getAttribute('data-m-anchor'), r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.height > 0 && r.top >= top - 1 && r.bottom <= bottom + 1)
      .sort((a, b) => Math.round(a.r.top) - Math.round(b.r.top) || a.r.left - b.r.left).map(a => rows ? { key: a.key, top: a.r.top } : a.key)
  }, rows)
}
async function scrollToItem(page, selector, n) {
  await page.evaluate(({ selector, n }) => {
    const el = document.querySelectorAll(selector)[n - 1]
    const top = document.querySelector('.m-topbar') ? Math.max(0, document.querySelector('.m-topbar').getBoundingClientRect().bottom) : 0
    window.scrollTo(0, window.scrollY + el.getBoundingClientRect().top - top)
  }, { selector, n })
  await page.waitForTimeout(400)
  await frame(page)
}
async function tag(page, selectors, value) {
  await page.evaluate(({ selectors, value }) => { for (const s of selectors) { const el = document.querySelector(s); if (el) el.__foldTag = value } }, { selectors, value })
}
async function tagsOf(page, selectors) {
  return page.evaluate(selectors => selectors.map(s => { const el = document.querySelector(s); return el ? (el.isConnected && el.__foldTag) || null : null }), selectors)
}
async function foldTo(page, size) {
  needSC()
  await page.setViewportSize({ width: size.width, height: size.height })
  await setInsets(page, size.insets)
  await frame(page)
  const shell = page.locator('.m-shell')
  await expect(shell).toHaveAttribute('data-width', size.width < SC.compactBelow ? 'compact' : 'regular')
  await expect(shell).toHaveAttribute('data-nav', size.expected.nav)
  await page.waitForTimeout(300)
  await frame(page)
}

const HISTORY = n => Array.from({ length: n }, (_, i) => ({ nzo_id: `fold-h${i + 1}`, name: `Fold.History.Item.${pad2(i + 1)}-GRP`, bytes: 1073741824, status: 'Completed',
  completed: Math.floor(Date.now() / 1000) - (i + 1) * 3600, category: 'software' }))
const CAL = () => {
  const out = []
  for (let i = 0; i < 30; i++) {
    const d = new Date(); d.setDate(d.getDate() + 1 + (i % 6)); d.setHours(8 + Math.floor(i / 6) * 2, 0, 0, 0)
    out.push({ id: 7000 + i, seriesId: 5000 + i, seasonNumber: 1, episodeNumber: 1, title: `Fold calendar episode ${i + 1}`, airDateUtc: d.toISOString(), hasFile: false,
      series: { id: 5000 + i, title: `Fold Calendar Show ${pad2(i + 1)}`, images: [{ coverType: 'poster', remoteUrl: 'https://localhost:18778/arrview-icon.svg' }] } })
  }
  return out
}
const EPISODES = () => [1, 2].flatMap(season => Array.from({ length: 24 }, (_, i) => ({ id: 9000 + season * 100 + i + 1, seriesId: 1, seasonNumber: season, episodeNumber: i + 1,
  title: `Fold episode ${season}x${pad2(i + 1)}`, hasFile: i % 3 === 0, episodeFileId: i % 3 === 0 ? 9000 + i : 0, airDateUtc: new Date(Date.UTC(2020, 0, 1 + i)).toISOString(), runtime: 42,
  images: [{ coverType: 'screenshot', remoteUrl: 'https://localhost:18778/arrview-icon.svg' }] })))
const NZB = () => Array.from({ length: 14 }, (_, i) => ({ title: `Fold.Search.Result.${pad2(i + 1)}-GRP`, guid: `fold-nzb-${i + 1}`, link: 'https://example.invalid/fold.nzb', size: 1073741824 }))

const ROWS = [
  { id: 'C1', name: 'Downloads: route, page root, history rows after Load more, history anchor', hash: '/downloads', wait: '.m-dl-section', anchor: { selector: 'li.m-dl-row.is-history, .m-dl-list > li > .m-dl-row.is-history', n: 10 },
    setup: async page => {
      await page.route('**/api/sabnzbd/history**', route => {
        const limit = Number(new URL(route.request().url()).searchParams.get('limit')) || 15
        const slots = HISTORY(45)
        return route.fulfill({ json: { history: { noofslots: slots.length, slots: slots.slice(0, limit) } } })
      })
    },
    act: async page => { await page.getByRole('button', { name: 'Load more' }).click(); await expect(page.locator('li.m-dl-row.is-history')).toHaveCount(18) },
    state: async (page, size) => ({ history: await page.locator('li.m-dl-row.is-history').count(), expectHistory: (size.width < 640 ? 3 : 5) + 15 }) },
  { id: 'C2', name: 'TV Shows, large posters: search, filter, sort, view, the 10th tile', hash: '/shows', wait: '.m-grid li', anchor: { selector: '.m-main [data-m-anchor^="show:"]', n: 10 }, enlarge: true,
    act: async page => libraryState(page, 'Search shows', 'Fold', 'Continuing', 'year'),
    state: async page => readLibrary(page, 'Search shows') },
  { id: 'C3', name: 'TV Shows, list view: search, filter, sort, view, the 10th row', hash: '/shows', wait: '.m-grid li', anchor: { selector: '.m-main [data-m-anchor^="show:"]', n: 10 }, enlarge: true,
    act: async page => { await libraryState(page, 'Search shows', 'Fold', 'Continuing', 'year'); await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'List' }).click(); await expect(page.locator('.m-list li').first()).toBeVisible() },
    state: async page => readLibrary(page, 'Search shows') },
  { id: 'C4', name: 'Movies, large posters: search, filter, sort, view, the 10th tile', hash: '/movies', wait: '.m-grid li', anchor: { selector: '.m-main [data-m-anchor^="movie:"]', n: 10 }, enlarge: true,
    act: async page => libraryState(page, 'Search movies', 'Fold', 'Monitored', 'added'),
    state: async page => readLibrary(page, 'Search movies') },
  { id: 'C5', name: 'Movies, list view: search, filter, sort, view, the 10th row', hash: '/movies', wait: '.m-grid li', anchor: { selector: '.m-main [data-m-anchor^="movie:"]', n: 10 }, enlarge: true,
    act: async page => { await libraryState(page, 'Search movies', 'Fold', 'Monitored', 'added'); await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'List' }).click(); await expect(page.locator('.m-list li').first()).toBeVisible() },
    state: async page => readLibrary(page, 'Search movies') },
  { id: 'C6', name: 'Upcoming, thumbnails: filter, view, the 6th tile', hash: '/upcoming', wait: '.m-utile', anchor: { selector: '.m-main [data-m-anchor^="upcoming:"]', n: 6 },
    setup: async page => { await page.route('**/api/sonarr/calendar**', async route => { const base = await (await route.fetch()).json(); await route.fulfill({ json: [...base, ...CAL()] }) }) },
    act: async page => { await page.getByRole('group', { name: 'Show' }).getByRole('button', { name: 'TV' }).click() },
    state: async page => readUpcoming(page) },
  { id: 'C7', name: 'Upcoming, list: filter, view, the 8th row', hash: '/upcoming', wait: '.m-utile', anchor: { selector: '.m-main [data-m-anchor^="upcoming:"]', n: 8 },
    setup: async page => { await page.route('**/api/sonarr/calendar**', async route => { const base = await (await route.fetch()).json(); await route.fulfill({ json: [...base, ...CAL()] }) }) },
    act: async page => { await page.getByRole('group', { name: 'Show' }).getByRole('button', { name: 'TV' }).click(); await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'List' }).click(); await expect(page.locator('.m-ulist-row').first()).toBeVisible() },
    state: async page => readUpcoming(page) },
  { id: 'C8', name: 'Show detail: season choice, season bar and episodes, the 8th episode', hash: '/shows/1', wait: 'li.m-ep', anchor: { selector: '.m-main [data-m-anchor^="episode:"]', n: 8 },
    setup: async page => { await page.route('**/api/sonarr/series/1/episodes', route => route.fulfill({ json: EPISODES() })) },
    act: async page => { await page.getByRole('combobox', { name: 'Season' }).selectOption('1'); await expect(page.locator('li.m-ep')).toHaveCount(24) },
    state: async page => ({ season: await page.getByRole('combobox', { name: 'Season' }).inputValue(), bar: await page.locator('.m-season-bar').count(), episodes: await page.locator('li.m-ep').count() }) },
  { id: 'C9', name: 'Movie detail: title and actions (no anchor)', hash: '/movies/2', wait: '.m-hero-actions',
    state: async page => ({ title: await page.locator('.m-hero-body h1').textContent(), actions: await page.locator('.m-hero-actions').count() }) },
  { id: 'C10', name: 'Search: query and results (no anchor)', hash: '/search', wait: '.nzb-search-input',
    setup: async page => { await page.route('**/api/nzbhydra/search**', route => route.fulfill({ json: NZB() })) },
    act: async page => {
      await page.getByRole('textbox', { name: 'Search for something to download' }).fill('fold')
      await page.getByRole('textbox', { name: 'Search for something to download' }).press('Enter')
      await expect(page.getByText('14 results')).toBeVisible()
    },
    state: async page => ({ query: await page.getByRole('textbox', { name: 'Search for something to download' }).inputValue(), count: await page.locator('.nzb-results-count').textContent() }) },
  { id: 'C11', name: 'Settings: an unsaved field value (no anchor)', hash: '/settings', wait: '.config-container',
    act: async page => {
      await page.getByRole('button', { name: 'SABnzbd', exact: true }).click()
      await page.locator('#sabnzbd-url').fill('http://fold.invalid:8080')
    },
    state: async page => ({ value: await page.locator('#sabnzbd-url').inputValue(), open: await page.getByRole('button', { name: 'SABnzbd', exact: true }).getAttribute('aria-expanded'),
      save: await page.getByRole('button', { name: 'Save', exact: true }).isEnabled() }),
    report: async page => page.evaluate(() => { const h = [...document.querySelectorAll('.m-main h2')].find(el => el.getBoundingClientRect().top >= 0); return h ? h.textContent : null }) },
  { id: 'C12', name: 'Add sheet open from TV Shows: query, results, selection and both switches (no anchor)', hash: '/shows', wait: '.m-grid li', sheet: true,
    act: async page => {
      await page.getByRole('button', { name: 'Add Show', exact: true }).first().click()
      const dialog = page.locator('dialog.sheet')
      await dialog.getByRole('textbox').fill('fixture')
      await dialog.getByRole('button', { name: 'Select A long fixture lookup result with descriptive text' }).click()
      for (const sw of await dialog.getByRole('switch').all()) await sw.uncheck()
    },
    state: async page => {
      const dialog = page.locator('dialog.sheet')
      return { open: await dialog.count(), query: await dialog.getByRole('textbox').first().inputValue(), results: await dialog.locator('.result-tile').count(),
        selected: await dialog.locator('.result-tile[aria-pressed="true"]').getAttribute('aria-label'), switches: await Promise.all((await dialog.getByRole('switch').all()).map(s => s.isChecked())) }
    } },
]
async function libraryState(page, field, query, chip, sort) {
  // On a short compact screen the search starts as a button with the field's name (criterion 21).
  if (!(await page.getByRole('textbox', { name: field }).count())) await page.getByRole('button', { name: field }).click()
  await page.getByRole('textbox', { name: field }).fill(query)
  await page.getByRole('group', { name: 'Filter' }).getByRole('button', { name: chip, exact: true }).click()
  await page.getByRole('combobox', { name: 'Sort results' }).selectOption(sort)
  await frame(page)
}
async function readLibrary(page, field) {
  return { search: await page.getByRole('textbox', { name: field }).inputValue(),
    chip: await page.getByRole('group', { name: 'Filter' }).locator('button[aria-pressed="true"]').textContent(),
    sort: await page.getByRole('combobox', { name: 'Sort results' }).inputValue(),
    view: await page.getByRole('group', { name: 'View' }).locator('button[aria-pressed="true"]').getAttribute('aria-label') }
}
async function readUpcoming(page) {
  return { chip: await page.getByRole('group', { name: 'Show' }).locator('button[aria-pressed="true"]').textContent(),
    view: await page.getByRole('group', { name: 'View' }).locator('button[aria-pressed="true"]').getAttribute('aria-label') }
}

async function runFold(browser, row, order) {
  const sequence = order === 'reverse' ? [FOLD.inner, FOLD.cover, FOLD.inner] : [FOLD.cover, FOLD.inner, FOLD.cover]
  const { context, page } = await openContext(browser, sequence[0])
  await page.addInitScript(() => { if (sessionStorage.getItem('fold-init')) return; sessionStorage.setItem('fold-init', '1'); for (const key of Object.keys(localStorage)) if (key.startsWith('arrview.ui.v1.') && key !== 'arrview.ui.v1.layout') localStorage.removeItem(key) })
  if (row.enlarge) await enlarge(page)
  if (row.setup) await row.setup(page)
  await page.goto(`/#${row.hash}`)
  await expect(page.locator(row.wait).first()).toBeVisible()
  if (row.act) await row.act(page)
  await frame(page)
  const selectors = ['.m-main', '.m-main > :first-child', ...(row.sheet ? ['dialog.sheet', 'dialog.sheet input[type="text"]'] : [])]
  await tag(page, selectors, row.id)
  const hash = await page.evaluate(() => location.hash)
  const state = await row.state(page, sequence[0])
  let key = null
  if (row.anchor) {
    expect(await page.locator(row.anchor.selector).count(), `${row.id}: the page carries data-m-anchor items`).toBeGreaterThanOrEqual(row.anchor.n)
    await scrollToItem(page, row.anchor.selector, row.anchor.n)
    const first = await anchorsIn(page)
    key = first[0]
    const stated = await page.locator(row.anchor.selector).nth(row.anchor.n - 1).getAttribute('data-m-anchor')
    // In a six-column row the stated tile is not the leftmost; the first fully visible anchor of its row is recorded.
    if (sequence[0].width < 640) expect(key, `${row.id}: the stated item is the first fully visible anchor`).toBe(stated)
  }
  for (const size of sequence.slice(1)) {
    await foldTo(page, size)
    expect.soft(await page.evaluate(() => location.hash), `${row.id} at ${size.id}: route`).toBe(hash)
    expect.soft(await tagsOf(page, selectors), `${row.id} at ${size.id}: same elements (no remount)`).toEqual(selectors.map(() => row.id))
    const now = await row.state(page, size)
    if (row.id === 'C1') { expect.soft(now.history, `${row.id} at ${size.id}: history rows`).toBe(now.expectHistory) }
    else expect.soft(now, `${row.id} at ${size.id}: page state`).toEqual(state)
    if (key) {
      // First or second fully visible anchor; in a grid row of three or six the remembered tile need not be leftmost, so
      // a tile in the first fully visible row counts as well (spec 32b read for multi-column grids; see build.md).
      const visible = await anchorsIn(page, { rows: true })
      const found = visible.find(item => item.key === key)
      const ok = Boolean(found) && (visible.slice(0, 2).some(item => item.key === key) || Math.abs(found.top - visible[0].top) < 2)
      expect.soft(ok, `${row.id} at ${size.id}: ${key} is the first or second fully visible item, or in the first fully visible row (got ${visible.slice(0, 3).map(v => v.key).join(', ')})`).toBe(true)
    }
    if (row.report) test.info().annotations.push({ type: 'section', description: `${size.id}: ${await row.report(page)}` })
  }
  await context.close()
}
test.describe('foldables: fold and unfold keep the page (continuity matrix)', () => {
  for (const row of ROWS) {
    test(`${row.id} ${row.name}${row.anchor ? '' : ''}: 461 > 951 > 461`, async ({ browser }) => { test.setTimeout(90000); await runFold(browser, row, 'forward') })
    if (['C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8'].includes(row.id)) {
      test(`${row.id} ${row.name}: reversed, 951 > 461 > 951`, async ({ browser }) => { test.setTimeout(90000); await runFold(browser, row, 'reverse') })
    }
  }
})

// Criterion 25: Upcoming shows at least two full tiles on the cover and four on the inner screen at scroll 0.
for (const [size, least] of [[FOLD.cover, 2], [FOLD.inner, 4]]) {
  test(`Upcoming: at least ${least} full tiles at scroll 0 at ${size.id} (criterion 25)`, async ({ browser }) => {
    const { context, page } = await openContext(browser, size)
    await page.route('**/api/sonarr/calendar**', async route => { const base = await (await route.fetch()).json(); await route.fulfill({ json: [...base, ...CAL()] }) })
    await show(page, PAGES[3])
    const full = await page.evaluate(() => [...document.querySelectorAll('.m-utile')].filter(el => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight }).length)
    expect(full).toBeGreaterThanOrEqual(least)
    await expect(page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Thumbnails' })).toHaveAttribute('aria-pressed', 'true')
    await context.close()
  })
}

// Criteria 26, 32c in the browser: backdrops are marked; anchors only on the stated families.
test('backdrops carry data-m-backdrop: the ambient art and the detail hero art (criterion 26)', async ({ browser }) => {
  const { context, page } = await openContext(browser, FOLD.cover)
  await show(page, PAGES[4])
  await expect(page.locator('.m-ambient')).toHaveAttribute('data-m-backdrop', '')
  await expect(page.locator('.m-hero .m-hero-art')).toHaveAttribute('data-m-backdrop', '')
  await context.close()
})

// Criteria 39, 39b: before/after screenshots, only with ARRVIEW_SHOTS_DIR; the effective insets are measured first.
const GEOMETRY = {}
function geometryOf(page) {
  return page.evaluate(() => {
    const px = v => Math.round(parseFloat(v) * 100) / 100
    const cs = el => getComputedStyle(el)
    const out = { vw: document.documentElement.clientWidth, vh: innerHeight }
    const topbar = document.querySelector('.m-topbar')
    if (topbar) out.topbar = { paddingTop: px(cs(topbar).paddingTop), height: px(topbar.getBoundingClientRect().height) }
    const bottom = document.querySelector('.m-bottomnav')
    if (bottom) out.bottombar = { paddingBottom: px(cs(bottom).paddingBottom), paddingLeft: px(cs(bottom).paddingLeft), paddingRight: px(cs(bottom).paddingRight), height: px(bottom.getBoundingClientRect().height) }
    const main = document.querySelector('.m-main')
    if (main) out.main = { hero: main.classList.contains('is-hero'), paddingLeft: px(cs(main).paddingLeft), paddingRight: px(cs(main).paddingRight), paddingTop: px(cs(main).paddingTop),
      left: px(main.getBoundingClientRect().left), right: px(out.vw - main.getBoundingClientRect().right) }
    const sheet = document.querySelector('dialog.sheet')
    if (sheet) {
      const box = sheet.getBoundingClientRect(), header = sheet.querySelector('.sheet-header'), content = sheet.querySelector('.sheet-content'), footer = sheet.querySelector('.add-footer')
      out.sheet = { box: { left: px(box.left), right: px(out.vw - box.right), top: px(box.top), bottom: px(out.vh - box.bottom) },
        headerInsetLeft: px(box.left + parseFloat(cs(header).paddingLeft)), headerInsetRight: px(out.vw - box.right + parseFloat(cs(header).paddingRight)),
        contentPaddingBottom: px(cs(content).paddingBottom), footerPaddingBottom: footer ? px(cs(footer).paddingBottom) : null }
    }
    const rail = document.querySelector('.m-rail')
    if (rail) { const r = rail.getBoundingClientRect(); out.rail = { left: px(r.left), right: px(out.vw - r.right), width: px(r.width), top: px(r.top), bottom: px(out.vh - r.bottom) } }
    const shell = document.querySelector('.m-shell')
    if (shell) out.shell = { nav: shell.dataset.nav || null, height: shell.dataset.height || null }
    return out
  })
}
function geometryMismatches(size, g) {
  const ins = insetsOf(size.insets), bad = []
  const near = (a, b) => Math.abs(a - b) < 0.6
  const want = (name, got, expected) => { if (!near(got, expected)) bad.push(`${name}: ${got}, expected ${expected}`) }
  const phone = size.width < 640
  if (g.topbar) { want('topbar.paddingTop', g.topbar.paddingTop, ins.top); want('topbar.height', g.topbar.height, 56 + ins.top) }
  if (g.bottombar) {
    want('bottombar.paddingBottom', g.bottombar.paddingBottom, ins.bottom)
    if (phone) { want('bottombar.paddingLeft', g.bottombar.paddingLeft, ins.left); want('bottombar.paddingRight', g.bottombar.paddingRight, ins.right) }
  }
  if (g.main && !g.main.hero) {
    const base = phone ? 12 : 24
    const railLeft = g.rail && g.rail.left < g.vw / 2, railRight = g.rail && !railLeft
    // Rail mode moves the content off the rail as well as the inset (an intended difference); the other side keeps max(base, inset).
    if (!railLeft) want('main.inset.left', g.main.left + g.main.paddingLeft, Math.max(base, ins.left) + (phone ? 0 : g.main.left))
    if (!railRight) want('main.inset.right', g.main.right + g.main.paddingRight, Math.max(base, ins.right) + (phone ? 0 : g.main.right))
    if (railLeft) want('main.inset.left (rail)', g.main.left + g.main.paddingLeft, g.rail.left + g.rail.width + base)
    if (railRight) want('main.inset.right (rail)', g.main.right + g.main.paddingRight, g.rail.right + g.rail.width + base)
    if (phone && (!g.shell || g.shell.height !== 'short')) want('main.paddingTop', g.main.paddingTop, 12 + ins.top)
  }
  if (g.sheet && phone) {
    want('sheet.header.inset.left', g.sheet.headerInsetLeft, Math.max(12, ins.left))
    want('sheet.header.inset.right', g.sheet.headerInsetRight, Math.max(12, ins.right))
    // The Add sheet's footer (when it is rendered) carries the bottom inset; without one the content does.
    if (g.sheet.footerPaddingBottom !== null) want('sheet.footer.paddingBottom', g.sheet.footerPaddingBottom, 12 + ins.bottom)
    else want('sheet.content.paddingBottom', g.sheet.contentPaddingBottom, ins.bottom)
  }
  return bad
}
test.describe('foldables: screenshots (only with ARRVIEW_SHOTS_DIR)', () => {
  test.skip(!SHOTS, 'set ARRVIEW_SHOTS_DIR to save the contact-sheet screenshots')
  for (const size of [...SIZES, ...REGRESSION].filter(s => s.shots)) {
    test(`shots ${size.id} ${size.width} x ${size.height}`, async ({ browser }) => {
      test.setTimeout(180000)
      const { context, page } = await openContext(browser, size)
      await enlarge(page)
      const entry = GEOMETRY[size.id] = { size: { width: size.width, height: size.height, insets: insetsOf(size.insets) }, pages: {}, mismatches: [] }
      try {
        for (const p of PAGES) {
          await show(page, p)
          await page.waitForTimeout(250)
          const g = await geometryOf(page)
          const bad = geometryMismatches(size, g)
          entry.pages[p.id] = { ...g, mismatches: bad }
          entry.mismatches.push(...bad.map(text => `${p.id}: ${text}`))
          if (!bad.length) await page.screenshot({ path: path.join(SHOTS, size.id, `${p.id}.png`), animations: 'disabled', caret: 'hide' })
          await closeSheet(page)
        }
        if (SHIM) entry.shim = await SHIM.totals(page)
      } finally {
        fs.mkdirSync(SHOTS, { recursive: true })
        const file = path.join(SHOTS, 'geometry.json')
        const all = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {}
        all[size.id] = entry
        fs.writeFileSync(file, JSON.stringify(all, null, 2))
        await context.close()
      }
      expect(entry.mismatches, `${size.id}: effective insets`).toEqual([])
    })
  }
})
