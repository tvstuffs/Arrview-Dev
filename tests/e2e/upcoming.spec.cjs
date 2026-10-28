const { test, expect } = require('@playwright/test')
const { seedClassic } = require('./classic.cjs')

// The worker answers /api requests itself, which page.route never sees: these tests run without it.
test.use({ serviceWorkers: 'block' })

const BASE = 'https://localhost:18778'
const DROP = 'S3 · Episodes 1–8'
const WIDTHS = [320, 402, 834, 1440]
const fits = page => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)
const context = (browser, options = {}) => browser.newContext({ ignoreHTTPSErrors: true, serviceWorkers: 'block', locale: 'en-US', ...options })
async function modern(browser, options = {}) {
  const ctx = await context(browser, options)
  const page = await ctx.newPage()
  return { ctx, page }
}
async function openModern(page) {
  await page.goto(`${BASE}/#/upcoming`)
  await expect(page.locator('main h1')).toHaveText('Upcoming')
  await expect(page.getByText('Loading upcoming…')).toHaveCount(0)
}
async function openClassic(ctx, page) {
  await seedClassic(ctx)
  await ctx.addInitScript(() => { if (!localStorage.getItem('arrview.ui.v1.tab')) localStorage.setItem('arrview.ui.v1.tab', '"upcoming"') })
  await page.goto(BASE)
  await expect(page.getByRole('heading', { name: 'Upcoming', level: 1 })).toBeVisible()
  await expect(page.getByText('Loading upcoming…')).toHaveCount(0)
}

for (const width of WIDTHS) {
  test(`Modern Upcoming at ${width}px: no overflow, one drop tile, 16:9 stills, 2:3 movie posters, no overlap, agenda columns (criteria 12, 25)`, async ({ browser }) => {
    const { ctx, page } = await modern(browser, { viewport: { width, height: 900 } })
    await openModern(page)
    await expect(page.locator('.m-utile', { hasText: DROP })).toHaveCount(1)
    await expect(page.locator('.m-utile', { hasText: 'S1, S2 · 2 episodes' })).toHaveCount(1)
    await expect(page.locator('.m-utile', { hasText: 'S1 · 3 episodes' })).toHaveCount(1)
    expect(await fits(page)).toBe(true)
    const layout = await page.evaluate(() => {
      const rect = el => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height } }
      const tiles = [...document.querySelectorAll('.m-utile')].map(rect)
      const overlap = tiles.some((a, i) => tiles.some((b, j) => j > i && a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5))
      const ratios = [...document.querySelectorAll('.m-utile-box')].map(rect).map(r => r.width / r.height)
      const lefts = new Set([...document.querySelectorAll('.m-agenda-day')].map(el => Math.round(el.getBoundingClientRect().left)))
      // A movie tile's sharp poster sits centred in the 16:9 box; it once collapsed to zero width and left only the blur.
      const posters = [...document.querySelectorAll('.m-utile.is-movie')].map(tile => ({ box: rect(tile.querySelector('.m-utile-box')), poster: rect(tile.querySelector('.m-utile-poster')) }))
      return { overlap, ratios, posters, columns: lefts.size, days: document.querySelectorAll('.m-agenda-day').length, tiles: tiles.length }
    })
    expect(layout.tiles).toBeGreaterThan(8)
    expect(layout.overlap).toBe(false)
    for (const ratio of layout.ratios) expect(Math.abs(ratio - 16 / 9)).toBeLessThan(0.02)
    expect(layout.posters.length).toBeGreaterThan(0)
    for (const { box, poster } of layout.posters) {
      expect(poster.height).toBeGreaterThan(box.height * 0.8)
      expect(Math.abs(poster.width / poster.height - 2 / 3)).toBeLessThan(0.02)
      expect(Math.abs((poster.left + poster.right) / 2 - (box.left + box.right) / 2)).toBeLessThan(1)
    }
    if (width <= 402) expect(layout.columns).toBe(1)
    if (width === 1440) { expect(layout.days).toBeGreaterThanOrEqual(2); expect(layout.columns).toBeGreaterThanOrEqual(2) }
    await ctx.close()
  })
  test(`Modern Upcoming list view at ${width}px has no overflow (criterion 25)`, async ({ browser }) => {
    const { ctx, page } = await modern(browser, { viewport: { width, height: 900 } })
    await page.addInitScript(() => localStorage.setItem('arrview.ui.v1.upcoming.view', '"list"'))
    await openModern(page)
    await expect(page.locator('.m-ulist-row', { hasText: DROP })).toHaveCount(1)
    expect(await fits(page)).toBe(true)
    await ctx.close()
  })
  test(`Classic Upcoming at ${width}px stays a list: no overflow, one drop row, movie rows, no chips (criteria 19, 25)`, async ({ browser }) => {
    const { ctx, page } = await modern(browser, { viewport: { width, height: 900 } })
    await openClassic(ctx, page)
    await expect(page.getByText(DROP)).toHaveCount(1)
    await expect(page.getByText('S01E02 · Calendar fixture episode')).toBeVisible()
    await expect(page.getByText('Movie · Digital release').first()).toBeVisible()
    await expect(page.getByText('Movie · Physical release · Steelbook edition')).toBeVisible()
    await expect(page.getByText(/Cinema Only Fixture Movie/)).toHaveCount(0)
    await expect(page.getByRole('group', { name: 'Show' })).toHaveCount(0)
    await expect(page.getByRole('group', { name: 'View' })).toHaveCount(0)
    expect(await fits(page)).toBe(true)
    await ctx.close()
  })
}

test('Modern: filter and view persist across a reload, and the filter survives a view switch (criteria 9, 14, 25)', async ({ browser }) => {
  const { ctx, page } = await modern(browser, { viewport: { width: 1280, height: 900 } })
  await openModern(page)
  await page.getByRole('button', { name: 'Movies', exact: true }).click()
  await expect(page.locator('.m-utile[href^="#/shows/"]')).toHaveCount(0)
  await page.getByRole('button', { name: 'List' }).click()
  await expect(page.locator('.m-ulist-row[href^="#/shows/"]')).toHaveCount(0)
  await expect(page.locator('.m-ulist-row[href^="#/movies/"]').first()).toBeVisible()
  await page.reload()
  await expect(page.locator('main h1')).toHaveText('Upcoming')
  await expect(page.getByRole('button', { name: 'Movies', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.m-ulist-row[href^="#/movies/"]').first()).toBeVisible()
  expect(await page.evaluate(() => [localStorage.getItem('arrview.ui.v1.upcoming.filter'), localStorage.getItem('arrview.ui.v1.upcoming.view')])).toEqual(['"movies"', '"list"'])
  await ctx.close()
})

test('Modern: a tile opens the show page or the movie page (criteria 15, 25)', async ({ browser }) => {
  const { ctx, page } = await modern(browser, { viewport: { width: 1280, height: 900 } })
  await openModern(page)
  await page.getByRole('link', { name: /^Fixture Show with a long title, season 1, episode 2,/ }).click()
  await expect(page).toHaveURL(/#\/shows\/1$/)
  await expect(page.locator('main h1')).toHaveText('Fixture Show with a long title')
  await page.goto(`${BASE}/#/upcoming`)
  await page.getByRole('link', { name: /^Fixture Movie with a long descriptive title, movie, digital release,/ }).click()
  await expect(page).toHaveURL(/#\/movies\/2$/)
  await expect(page.locator('main h1')).toHaveText('Fixture Movie with a long descriptive title')
  await ctx.close()
})

for (const layout of ['modern', 'classic']) {
  test(`${layout}: one service failing shows its error with Retry and the other service's items (criteria 16, 19, 25)`, async ({ browser }) => {
    const { ctx, page } = await modern(browser, { viewport: { width: 834, height: 900 } })
    let down = true
    await page.route('**/api/sonarr/calendar**', route => (down ? route.fulfill({ status: 503, json: { error: 'down' } }) : route.continue()))
    if (layout === 'modern') await openModern(page); else await openClassic(ctx, page)
    await expect(page.getByRole('alert')).toContainText('Cannot reach Sonarr')
    await expect(page.getByText(DROP)).toHaveCount(0)
    await expect(page.getByText('Movie · Digital release').first()).toBeVisible()
    down = false
    await page.getByRole('button', { name: 'Retry Sonarr upcoming' }).click()
    await expect(page.getByRole('alert')).toHaveCount(0)
    await expect(page.getByText(DROP)).toHaveCount(1)
    await ctx.close()
  })
}

test('Classic: an episode row opens the Shows tab and a movie row opens the Movies tab (criterion 19)', async ({ browser }) => {
  const { ctx, page } = await modern(browser, { viewport: { width: 1280, height: 900 } })
  await openClassic(ctx, page)
  await page.getByRole('button', { name: /Fixture Show with a long title S01E02/ }).click()
  await expect(page.getByRole('button', { name: 'Shows', exact: true })).toHaveAttribute('aria-current', 'page')
  // The tab bar's button, by where it is: once the Shows page has loaded it has an "Upcoming" button of its own, and
  // a locator by name alone then matches two (it failed in CI, twice, on 2026-10-23, whenever the page loaded first).
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Upcoming', exact: true }).click()
  await page.getByRole('button', { name: /Fixture Movie with a long descriptive title/ }).click()
  await expect(page.getByRole('button', { name: 'Movies', exact: true })).toHaveAttribute('aria-current', 'page')
  await ctx.close()
})

test('Modern: reduced motion leaves the new tiles with no transition time (criterion 25)', async ({ browser }) => {
  const { ctx, page } = await modern(browser, { viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' })
  await openModern(page)
  const durations = await page.locator('.m-utile, .m-agenda-day, .m-chips button').evaluateAll(els => els.map(el => getComputedStyle(el).transitionDuration))
  expect(durations.length).toBeGreaterThan(5)
  for (const duration of durations) expect(duration).toBe('0s')
  await ctx.close()
})

test('Modern on a touch phone: chips, view buttons, Retry and tiles are at least 44 px (criterion 18)', async ({ browser }) => {
  const { ctx, page } = await modern(browser, { viewport: { width: 402, height: 874 }, hasTouch: true, isMobile: true })
  await page.route('**/api/radarr/calendar**', route => route.fulfill({ status: 503, json: { error: 'down' } }))
  await openModern(page)
  await expect(page.getByRole('button', { name: 'Retry Radarr upcoming' })).toBeVisible()
  const small = await page.locator('.m-upcoming .m-chips button, .m-upcoming .m-viewtoggle button, .m-uerror .btn, .m-utile').evaluateAll(els => els
    .map(el => ({ name: el.getAttribute('aria-label') || el.textContent.trim().slice(0, 30), box: el.getBoundingClientRect() }))
    .filter(item => item.box.width < 43.9 || item.box.height < 43.9).map(item => `${item.name} ${item.box.width}x${item.box.height}`))
  expect(small).toEqual([])
  await ctx.close()
})

// ---- Time zones (criterion 23) ----
const TZ_CASES = [
  { zone: 'America/Los_Angeles', first: '2026-10-16', last: '2026-10-31', before: '2026-10-15', after: '2026-11-01',
    firstWeekday: 'Friday', lastWeekday: 'Saturday', start: '2026-10-15T07:00:00.000Z', end: '2026-11-02T07:59:59.999Z' },
  { zone: 'Pacific/Auckland', first: '2026-10-17', last: '2026-11-01', before: '2026-10-16', after: '2026-11-02',
    firstWeekday: 'Saturday', lastWeekday: 'Sunday', start: '2026-10-15T11:00:00.000Z', end: '2026-11-02T10:59:59.999Z' },
]
for (const c of TZ_CASES) {
  test(`${c.zone}: Radarr releases keep their calendar day at both ends of the window and the request is padded (criterion 23)`, async ({ browser }) => {
    const { ctx, page } = await modern(browser, { viewport: { width: 1280, height: 900 }, timezoneId: c.zone })
    const movie = (id, title, day) => ({ id, title, monitored: true, hasFile: false, isAvailable: true, digitalRelease: `${day}T00:00:00Z`, images: [] })
    let radarrUrl = null
    await page.clock.install({ time: new Date('2026-10-18T05:30:00Z') })
    await page.route('**/api/sonarr/calendar**', route => route.fulfill({ json: [] }))
    await page.route('**/api/radarr/calendar**', route => {
      radarrUrl = new URL(route.request().url())
      return route.fulfill({ json: [movie(1, 'First Day Movie', c.first), movie(2, 'Last Day Movie', c.last), movie(3, 'Before Movie', c.before), movie(4, 'After Movie', c.after)] })
    })
    await openModern(page)
    const day = title => page.locator('.m-agenda-day', { has: page.locator('.m-utile-title', { hasText: title }) }).locator('h2')
    await expect(day('First Day Movie')).toContainText(c.firstWeekday)
    await expect(day('Last Day Movie')).toContainText(c.lastWeekday)
    await expect(day('First Day Movie')).toContainText(new Date(`${c.first}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' }))
    await expect(day('Last Day Movie')).toContainText(new Date(`${c.last}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' }))
    await expect(page.getByText('Before Movie')).toHaveCount(0)
    await expect(page.getByText('After Movie')).toHaveCount(0)
    expect(radarrUrl.searchParams.get('start')).toBe(c.start)
    expect(radarrUrl.searchParams.get('end')).toBe(c.end)
    await ctx.close()
  })
}
