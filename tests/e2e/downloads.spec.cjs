const { test, expect } = require('@playwright/test')
const { seedClassic } = require('./classic.cjs')

// The worker answers /api requests itself, which page.route never sees; the fixture request log is read instead.
test.use({ serviceWorkers: 'block' })

const BASE = 'https://localhost:18778'
// The history fixture counts back from this instant, and page.clock.install puts the page on it (UTC, mid-day, no midnight nearby).
const NOW = Date.parse('2026-03-18T15:00:00Z')
const WIDTHS = [320, 402, 834, 1440]
const SHOW = 'Fixture Show with a long title'
const fits = page => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)
const control = (request, path, data) => request.post(`${BASE}${path}`, { data })

// A fresh context on the chosen fake downloads scenario; `now` (ms) is the page clock and the fixture's history clock.
async function setup(browser, { scenario, now = NOW, viewport = { width: 1440, height: 900 }, ...options }) {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, serviceWorkers: 'block', locale: 'en-US', timezoneId: 'UTC', viewport, ...options })
  await control(ctx.request, '/__fixture/downloads', { scenario })
  await control(ctx.request, '/__fixture/clock', { now })
  await control(ctx.request, '/__fixture/reset-requests')
  const page = await ctx.newPage()
  if (now !== null) await page.clock.install({ time: now })
  return { ctx, page }
}
test.afterEach(async ({ request }) => {
  await control(request, '/__fixture/downloads', { scenario: 'legacy' })
  await control(request, '/__fixture/clock', { now: null })
  await control(request, '/__fixture/reset-requests')
})

const log = async page => (await page.request.get(`${BASE}/__fixture/requests`)).json()
const KINDS = {
  sab: r => r.path === '/api' && r.query.mode === 'queue' && !r.query.name,
  history: r => r.path === '/api' && r.query.mode === 'history',
  sonarr: r => r.path.endsWith('/queue') && 'includeSeries' in r.query,
  radarr: r => r.path.endsWith('/queue') && 'includeMovie' in r.query,
}
const counts = entries => Object.fromEntries(Object.entries(KINDS).map(([kind, match]) => [kind, entries.filter(match).length]))
const total = async page => counts(await log(page))
// Fetches are real network calls: wait until the request log stops growing.
async function settle(page) {
  let last = -1, stable = 0
  while (stable < 3) {
    const size = (await log(page)).length
    stable = size === last ? stable + 1 : 0
    last = size
    await new Promise(resolve => setTimeout(resolve, 120))
  }
}
// Jump the page clock forward once (which also pauses it), take the baseline, then run 3 x 10 s of page time (D40).
async function thirtySeconds(page) {
  await page.clock.pauseAt(NOW + 60000)
  await settle(page)
  const before = await total(page)
  for (let step = 0; step < 3; step++) { await page.clock.runFor(10000); await settle(page) }
  const after = await total(page)
  return Object.fromEntries(Object.keys(before).map(kind => [kind, after[kind] - before[kind]]))
}
const between = (value, low, high) => { expect(value).toBeGreaterThanOrEqual(low); expect(value).toBeLessThanOrEqual(high) }
const queueRows = page => page.locator('.m-dl-cols > .m-dl-section:nth-child(1) li.m-dl-row')
const historyRows = page => page.locator('.m-dl-cols > .m-dl-section:nth-child(2) li.m-dl-row')
const row = (page, text) => page.locator('li.m-dl-row', { hasText: text })

for (const width of WIDTHS) {
  const touch = width === 402
  test(`Modern Downloads at ${width}px: hero, queue rows, history, unmatched glyph tiles, no overflow, columns and the pill (criterion 28)`, async ({ browser }) => {
    const { ctx, page } = await setup(browser, { scenario: 'rich', viewport: { width, height: 900 }, hasTouch: touch, isMobile: touch })
    await page.goto(`${BASE}/#/downloads`)
    const hero = page.locator('.m-dl-hero')
    await expect(hero.getByRole('heading', { level: 2, name: SHOW })).toBeVisible()
    await expect(hero.getByText('Season 1, Episode 2 · Missing episode with a long title')).toBeVisible()
    await expect(hero.getByText('4K · Dolby Vision · HDR · Atmos')).toBeVisible()
    await expect(queueRows(page)).toHaveCount(5)
    // Four history slots: phones (below 640 px) show three rows and Load more, wider screens all four.
    await expect(historyRows(page)).toHaveCount(width < 640 ? 3 : 4)
    if (width < 640) await expect(page.getByRole('button', { name: 'Load more' })).toBeVisible()
    // Unmatched: music, software, a show that is not in Sonarr and the case-mismatched id each show a category glyph tile.
    await expect(page.locator('.m-dl-cols > .m-dl-section:nth-child(1) .m-dl-glyph')).toHaveCount(4)
    for (const label of ['Music', 'Software']) await expect(queueRows(page).getByRole('img', { name: label })).toHaveCount(1)
    await expect(queueRows(page).getByRole('img', { name: 'TV' })).toHaveCount(2)
    const caseRow = row(page, 'Fixture Case Show')
    await expect(caseRow.locator('.m-dl-glyph')).toHaveCount(1)
    await expect(caseRow.getByRole('link')).toHaveCount(0)
    await expect(caseRow.getByText('Not in Sonarr')).toBeVisible()
    await expect(row(page, 'Unlisted Fixture Show').getByText('Not in Sonarr')).toBeVisible()
    await expect(row(page, 'Fixture Editor 3 2 1')).toBeVisible()
    await expect(row(page, 'Fixture Editor 3 2 1').locator('.m-dl-row-title')).toHaveAttribute('title', /Setup\.With\.A\.Very\.Long\.Release\.Name/)
    // Relative times come from the fixed page clock.
    await expect(page.getByText('25 min ago', { exact: true })).toHaveCount(1)
    await expect(page.getByText('Yesterday', { exact: true })).toHaveCount(1)
    await expect(page.getByText('3 days ago', { exact: true })).toHaveCount(1)
    await expect(page.getByText('Failed', { exact: true })).toBeVisible()
    expect(await fits(page)).toBe(true)
    await expect(page.locator('.m-live-pill')).toHaveCount(width >= 640 ? 1 : 0)
    if (width >= 640) await expect(page.getByRole('link', { name: 'Downloads, 64%, 47.1 MB/s' })).toBeVisible()
    await expect(page.locator('.m-topbar')).toHaveCount(width >= 640 ? 1 : 0)
    const boxes = await Promise.all([page.locator('.m-dl-cols > .m-dl-section:nth-child(1)').boundingBox(), page.locator('.m-dl-cols > .m-dl-section:nth-child(2)').boundingBox()])
    if (width >= 1024) { expect(boxes[1].x).toBeGreaterThan(boxes[0].x + boxes[0].width - 1); expect(Math.abs(boxes[1].y - boxes[0].y)).toBeLessThan(2) }
    else { expect(Math.abs(boxes[1].x - boxes[0].x)).toBeLessThan(2); expect(boxes[1].y).toBeGreaterThan(boxes[0].y + boxes[0].height - 1) }
    if (touch) {
      const controls = await page.locator('.m-dl button, .m-dl a.btn').evaluateAll(els => els.map(el => {
        const box = el.getBoundingClientRect()
        return { name: el.getAttribute('aria-label') || el.textContent.trim(), width: box.width, height: box.height, background: getComputedStyle(el).backgroundColor }
      }))
      expect(controls.length).toBeGreaterThan(10)
      for (const item of controls) {
        expect(item.width, item.name).toBeGreaterThanOrEqual(43.9)
        expect(item.height, item.name).toBeGreaterThanOrEqual(43.9)
        expect(['rgba(0, 0, 0, 0)', 'transparent'], `${item.name} background`).not.toContain(item.background)
      }
      for (const name of ['Pause', 'Resume', 'Remove from SABnzbd Queue', 'Pause All', 'Search NZBs']) expect(controls.map(item => item.name), name).toContain(name)
    }
    await hero.getByRole('heading', { level: 2, name: SHOW }).getByRole('link').click()
    await expect(page).toHaveURL(/#\/shows\/1$/)
    await ctx.close()
  })
}

test('Remove asks first and sends one delete only after the confirm; Pause and Pause All send the Classic calls (criterion 29)', async ({ browser }) => {
  const { ctx, page } = await setup(browser, { scenario: 'rich' })
  await page.goto(`${BASE}/#/downloads`)
  const music = row(page, 'Fixture Artist-Fixture Album')
  await expect(music).toBeVisible()
  const deletes = async () => (await log(page)).filter(r => r.query.name === 'delete')
  await music.getByRole('button', { name: 'Remove from SABnzbd Queue' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('Remove download?')).toBeVisible()
  await expect(dialog.getByText(/Remove “Fixture\.Artist-Fixture\.Album-FLAC-24bit-GRP” from the SABnzbd queue/)).toBeVisible()
  await settle(page)
  expect(await deletes()).toHaveLength(0)
  await dialog.getByRole('button', { name: 'Remove from SABnzbd Queue' }).click()
  await expect.poll(async () => (await deletes()).length).toBe(1)
  expect((await deletes())[0].query).toMatchObject({ mode: 'queue', name: 'delete', value: 'mu1' })
  await expect(page.getByText('Item removed from the SABnzbd queue')).toBeVisible()
  await music.getByRole('button', { name: 'Pause' }).click()
  await expect.poll(async () => (await log(page)).filter(r => r.query.name === 'pause' && r.query.value === 'mu1').length).toBe(1)
  await page.getByRole('button', { name: 'Pause All' }).click()
  await expect.poll(async () => (await log(page)).filter(r => r.query.mode === 'pause' && !r.query.name).length).toBe(1)
  await ctx.close()
})

test('idle: the last finished download leads, the empty note and Coming up (three rows at most, See all opens Upcoming) (criterion 29)', async ({ browser }) => {
  // The calendar fixture is relative to the real clock, so this page runs on the real "now".
  const { ctx, page } = await setup(browser, { scenario: 'empty', now: Date.now() })
  await page.goto(`${BASE}/#/downloads`)
  const hero = page.locator('.m-dl-hero')
  await expect(hero.getByText('Downloaded 25 min ago')).toBeVisible()
  await expect(hero.getByRole('heading', { level: 2, name: SHOW })).toBeVisible()
  await expect(hero.getByText('S1 E1')).toBeVisible()
  await expect(page.getByText('Nothing is downloading. When Sonarr or Radarr grabs an episode or movie, it appears here.')).toBeVisible()
  await expect(page.getByRole('button', { name: /Pause All|Resume All/ })).toHaveCount(0)
  const coming = page.locator('.m-dl-coming')
  await expect(coming.getByRole('heading', { level: 2, name: 'Coming up' })).toBeVisible()
  await expect(coming.locator('a.m-dl-row')).toHaveCount(3)
  await coming.getByRole('link', { name: /See all/ }).click()
  await expect(page).toHaveURL(/#\/upcoming$/)
  await expect(page.locator('main h1')).toHaveText('Upcoming')
  await ctx.close()
})
test('idle with no artwork: the plain Downloads header and the empty note (criterion 29)', async ({ browser }) => {
  const { ctx, page } = await setup(browser, { scenario: 'empty-noart' })
  await page.goto(`${BASE}/#/downloads`)
  await expect(page.locator('main h1')).toHaveText('Downloads')
  await expect(page.locator('main h1')).not.toHaveClass(/m-sr/)
  await expect(page.locator('.m-meta', { hasText: 'Nothing is downloading' })).toBeVisible()
  await expect(page.locator('.m-dl-hero')).toHaveCount(0)
  await expect(page.getByText('Nothing is downloading. When Sonarr or Radarr grabs an episode or movie, it appears here.')).toBeVisible()
  await expect(historyRows(page)).toHaveCount(2)
  await ctx.close()
})
test('a paused queue still leads with its first item and shows no pill (criterion 28)', async ({ browser }) => {
  const { ctx, page } = await setup(browser, { scenario: 'paused' })
  await page.goto(`${BASE}/#/downloads`)
  await expect(page.locator('.m-dl-hero').getByText('Paused', { exact: true })).toBeVisible()
  await expect(page.locator('.m-dl-hero').getByRole('button', { name: 'Resume' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Resume All' })).toBeVisible()
  await expect(page.locator('.m-live-pill')).toHaveCount(0)
  await ctx.close()
})

test('show page and movie surfaces show the live download status of the matched episode and movie (criterion 29)', async ({ browser }) => {
  const { ctx, page } = await setup(browser, { scenario: 'rich', now: null })
  await page.goto(`${BASE}/#/shows/1`)
  const episode = page.locator('li.m-ep', { hasText: 'Missing episode with a long title' })
  await expect(episode.getByText('Downloading', { exact: true })).toBeVisible()
  await expect(episode.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '64')
  await expect(episode.getByText('64% · 1 min left')).toBeVisible()
  await expect(episode.getByRole('button', { name: /Download|Interactive search/ })).toHaveCount(0)
  await expect(page.locator('li.m-ep', { hasText: 'Downloaded episode with a long descriptive title' }).getByText('Downloaded', { exact: true })).toBeVisible()
  await page.goto(`${BASE}/#/movies`)
  const tile = page.locator('.m-tilewrap', { hasText: 'Fixture Movie with a long descriptive title' })
  await expect(tile.getByText('Paused · 12%')).toBeVisible()
  await expect(tile.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '12')
  await page.goto(`${BASE}/#/movies/2`)
  await expect(page.locator('.m-statusline')).toHaveText('Paused · 12%')
  await expect(page.locator('.m-movie-poster .m-live-bar')).toHaveAttribute('aria-valuenow', '12')
  await ctx.close()
})

test('Classic Downloads is unchanged and never asks for the Sonarr or Radarr queue (criteria 29, D36)', async ({ browser }) => {
  const { ctx, page } = await setup(browser, { scenario: 'rich', now: null })
  await seedClassic(ctx)
  await page.goto(BASE)
  await expect(page.getByRole('heading', { name: 'Queue (6)' })).toBeVisible()
  await expect(page.getByText('Recent History')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Refresh downloads' })).toBeVisible()
  await expect(page.locator('.m-shell')).toHaveCount(0)
  await settle(page)
  const seen = await total(page)
  expect(seen.sab).toBeGreaterThan(0)
  expect([seen.sonarr, seen.radarr]).toEqual([0, 0])
  await ctx.close()
})

test('reduced motion stops the pulse; otherwise the live dot pulses (criterion 26)', async ({ browser }) => {
  for (const reduce of [false, true]) {
    const { ctx, page } = await setup(browser, { scenario: 'rich', now: null, reducedMotion: reduce ? 'reduce' : 'no-preference' })
    await page.goto(`${BASE}/#/downloads`)
    const dot = page.locator('.m-live-dot').first()
    await expect(dot).toBeVisible()
    const style = await dot.evaluate(el => ({ name: getComputedStyle(el).animationName, duration: getComputedStyle(el).animationDuration }))
    if (reduce) expect(style.name === 'none' || style.duration === '0s').toBe(true)
    else expect(style.name).toBe('m-live-pulse')
    await ctx.close()
  }
})

// ---- Polling (criterion 30): page.clock.install before the first navigation, cadence only with page.clock.runFor ----
test('polling, empty queue on Downloads: the Sonarr and Radarr queues are never requested', async ({ browser }) => {
  const { ctx, page } = await setup(browser, { scenario: 'empty' })
  await page.goto(`${BASE}/#/downloads`)
  await expect(page.locator('.m-dl-hero')).toBeVisible()
  const window = await thirtySeconds(page)
  const seen = await total(page)
  expect([seen.sonarr, seen.radarr]).toEqual([0, 0])
  between(window.sab, 2, 4)
  await ctx.close()
})
test('polling, rich Downloads at 1440: both arr queues every 10 s, the SABnzbd queue while downloading, history every 10 s', async ({ browser }) => {
  const { ctx, page } = await setup(browser, { scenario: 'rich' })
  await page.goto(`${BASE}/#/downloads`)
  await expect(page.locator('.m-dl-hero')).toBeVisible()
  const window = await thirtySeconds(page)
  between(window.sonarr, 2, 4); between(window.radarr, 2, 4); between(window.sab, 3, 16); between(window.history, 2, 4)
  await ctx.close()
})
test('polling, wide Upcoming with the pill: the SABnzbd queue only, no Sonarr or Radarr queue', async ({ browser }) => {
  const { ctx, page } = await setup(browser, { scenario: 'rich' })
  await page.goto(`${BASE}/#/upcoming`)
  await expect(page.locator('main h1')).toHaveText('Upcoming')
  await expect(page.locator('.m-live-pill')).toBeVisible()
  const window = await thirtySeconds(page)
  between(window.sab, 2, 4)
  const seen = await total(page)
  expect([window.sonarr, window.radarr, seen.sonarr, seen.radarr]).toEqual([0, 0, 0, 0])
  await ctx.close()
})
test('polling, phone on Upcoming and Search: no queue request at all', async ({ browser }) => {
  for (const hash of ['/upcoming', '/search']) {
    const { ctx, page } = await setup(browser, { scenario: 'rich', viewport: { width: 402, height: 874 }, hasTouch: true, isMobile: true })
    await page.goto(`${BASE}/#${hash}`)
    await expect(page.locator('main h1')).toHaveText(hash === '/upcoming' ? 'Upcoming' : 'Search')
    await thirtySeconds(page)
    const seen = await total(page)
    expect([seen.sab, seen.sonarr, seen.radarr]).toEqual([0, 0, 0])
    await ctx.close()
  }
})
test('polling, show page: a show with no queued episode costs one Sonarr request; the show with one polls every 10 s', async ({ browser }) => {
  let { ctx, page } = await setup(browser, { scenario: 'rich' })
  await page.goto(`${BASE}/#/shows/6`)
  await expect(page.locator('main h1')).toHaveText('Second Fixture Show')
  let window = await thirtySeconds(page)
  let seen = await total(page)
  expect(window.sonarr).toBe(0)
  expect([seen.sonarr, seen.radarr]).toEqual([1, 0])
  await ctx.close()

  ;({ ctx, page } = await setup(browser, { scenario: 'rich' }))
  await page.goto(`${BASE}/#/shows/1`)
  await expect(page.locator('main h1')).toHaveText(SHOW)
  await expect(page.locator('li.m-ep', { hasText: 'Missing episode with a long title' }).getByText('Downloading', { exact: true })).toBeVisible()
  window = await thirtySeconds(page)
  between(window.sonarr, 2, 4)
  seen = await total(page)
  expect(seen.radarr).toBe(0)
  await ctx.close()
})
test('polling, Movies page with a matched paused movie: the Radarr queue every 10 s, never Sonarr', async ({ browser }) => {
  const { ctx, page } = await setup(browser, { scenario: 'rich' })
  await page.goto(`${BASE}/#/movies`)
  await expect(page.locator('.m-tilewrap', { hasText: 'Fixture Movie with a long descriptive title' }).getByText('Paused · 12%')).toBeVisible()
  const window = await thirtySeconds(page)
  between(window.radarr, 2, 4)
  const seen = await total(page)
  expect([window.sonarr, seen.sonarr]).toEqual([0, 0])
  await ctx.close()
})
