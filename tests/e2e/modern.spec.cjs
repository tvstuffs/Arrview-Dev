const { test, expect } = require('@playwright/test')

// The page's own network interception (page.route) never sees requests answered by the service worker,
// so these tests run without it; the production-build test below opts back in.
test.use({ serviceWorkers: 'block' })
const SHOW = 'Fixture Show with a long title'
const MOVIE = 'Fixture Movie with a long descriptive title'
const EP_DOWNLOADED = 'Downloaded episode with a long descriptive title'
const LIVE = 'rgb(63, 208, 243)'
const TEXT = 'rgb(245, 245, 247)'
const fits = page => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)
const nameOf = el => el.getAttribute('aria-label') || el.textContent.replace(/\s+/g, ' ').trim()
const heading = page => page.locator('main h1')
async function open(page, hash) {
  await page.goto(`/#${hash}`)
  await expect(heading(page)).toBeVisible()
}
// A second movie with a future digital release, served only to the tests that need it.
async function twoMovies(page) {
  const base = await (await page.request.get('/api/radarr/movies')).json()
  const future = new Date(Date.now() + 5 * 86400000).toISOString()
  const second = { ...base[0], id: 3, title: 'Upcoming fixture movie', monitored: true, isAvailable: false, status: 'announced', digitalRelease: future, images: [] }
  await page.route('**/api/radarr/movies', route => route.fulfill({ json: [...base, second] }))
}

test('Modern is the default shell; the layout choice persists across reload and keeps the section (criteria 1 to 3)', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.m-shell')).toBeVisible()
  await expect(page.locator('.tabbar')).toHaveCount(0)
  await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link')).toHaveCount(5)
  await expect(page).toHaveURL(/#\/downloads$/)
  await page.getByRole('link', { name: 'Settings', exact: true }).click()
  const layout = page.getByRole('group', { name: 'Layout' })
  await expect(layout.getByRole('radio', { name: 'Modern' })).toBeChecked()
  await layout.getByRole('radio', { name: 'Classic' }).check()
  await expect(page.locator('.tabbar')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Add to Home Screen' })).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('arrview.ui.v1.layout'))).toBe('"classic"')
  await page.reload()
  await expect(page.locator('.tabbar')).toBeVisible()
  expect(page.url()).not.toContain('#')
  await page.getByRole('group', { name: 'Layout' }).getByRole('radio', { name: 'Modern' }).check()
  await expect(page.locator('.m-shell')).toBeVisible()
  await expect(page).toHaveURL(/#\/settings$/)
})
test('the section survives a switch in both directions, including detail routes', async ({ page }) => {
  await open(page, '/movies')
  await page.evaluate(() => localStorage.setItem('arrview.ui.v1.layout', '"classic"'))
  await page.reload()
  await expect(page.getByRole('button', { name: 'Movies', exact: true })).toHaveAttribute('aria-current', 'page')
  await page.getByRole('button', { name: 'Shows', exact: true }).click()
  await page.evaluate(() => localStorage.setItem('arrview.ui.v1.layout', '"modern"'))
  await page.reload()
  await expect(heading(page)).toHaveText('TV Shows')
  await expect(page).toHaveURL(/#\/shows$/)
  await open(page, '/shows/1')
  await page.evaluate(() => localStorage.setItem('arrview.ui.v1.layout', '"classic"'))
  await page.reload()
  await expect(page.getByRole('button', { name: 'Shows', exact: true })).toHaveAttribute('aria-current', 'page')
  expect(page.url()).not.toContain('#')
})
test('routes: links, Back/Forward, reload and deep links render each page (criteria 5, 6)', async ({ page, browser }) => {
  await open(page, '/downloads')
  const nav = page.getByRole('navigation', { name: 'Main navigation' })
  await nav.getByRole('link', { name: 'Shows' }).click()
  await expect(heading(page)).toHaveText('TV Shows')
  await page.getByRole('link', { name: SHOW }).click()
  await expect(heading(page)).toHaveText(SHOW)
  await expect(page).toHaveURL(/#\/shows\/1$/)
  await page.getByRole('link', { name: 'Back to TV Shows' }).click()
  await expect(heading(page)).toHaveText('TV Shows')
  await page.goBack(); await expect(heading(page)).toHaveText(SHOW)
  await page.goBack(); await expect(heading(page)).toHaveText('TV Shows')
  await page.goForward(); await expect(heading(page)).toHaveText(SHOW)
  await page.reload(); await expect(heading(page)).toHaveText(SHOW)
  await nav.getByRole('link', { name: 'Upcoming' }).click(); await expect(heading(page)).toHaveText('Upcoming')
  await page.getByRole('button', { name: new RegExp(SHOW) }).click()
  await expect(heading(page)).toHaveText(SHOW)
  await nav.getByRole('link', { name: 'Movies' }).click(); await expect(heading(page)).toHaveText('Movies')
  await page.getByRole('link', { name: MOVIE }).click({ position: { x: 8, y: 8 } }); await expect(heading(page)).toHaveText(MOVIE)
  await page.getByRole('link', { name: 'Back to Movies' }).click()
  await nav.getByRole('link', { name: 'Search' }).click(); await expect(heading(page)).toHaveText('Search')
  await page.getByRole('link', { name: 'Settings', exact: true }).click(); await expect(heading(page)).toHaveText('Settings')
  for (const [hash, title] of [['/downloads', 'Downloads'], ['/shows', 'TV Shows'], ['/shows/1', SHOW], ['/upcoming', 'Upcoming'], ['/movies', 'Movies'], ['/movies/2', MOVIE], ['/search', 'Search'], ['/settings', 'Settings']]) {
    const fresh = await (await browser.newContext({ ignoreHTTPSErrors: true })).newPage()
    await fresh.goto(`https://localhost:18778/#${hash}`)
    await expect(heading(fresh)).toHaveText(title)
    await fresh.context().close()
  }
})
test('not-found states and redirects that add no history entries (criterion 6)', async ({ page }) => {
  await page.goto('about:blank')
  await page.goto('/#/nope')
  await expect(page).toHaveURL(/#\/downloads$/)
  await page.goBack()
  expect(page.url()).toBe('about:blank')
  await page.goto('/')
  await expect(page).toHaveURL(/#\/downloads$/)
  await page.goBack()
  expect(page.url()).toBe('about:blank')
  await open(page, '/shows/abc')
  await expect(heading(page)).toHaveText('Not found')
  await expect(page.getByText('That show could not be found.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Back to TV Shows' })).toHaveAttribute('href', '#/shows')
  await open(page, '/shows/999'); await expect(page.getByText('That show could not be found.')).toBeVisible()
  await open(page, '/movies/999'); await expect(page.getByText('That movie could not be found.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Back to Movies' })).toHaveAttribute('href', '#/movies')
})
test('focus lands on the h1 with the page at the top after a route change (criterion 31)', async ({ page }) => {
  await open(page, '/shows')
  await page.evaluate(() => window.scrollTo(0, 400))
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Movies' }).click()
  await expect(heading(page)).toHaveText('Movies')
  expect(await page.evaluate(() => document.activeElement.tagName)).toBe('H1')
  expect(await page.evaluate(() => window.scrollY)).toBe(0)
})
test('the production build serves a deep link under the worker (criterion 7)', async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: 'allow', ignoreHTTPSErrors: true })
  const page = await context.newPage()
  await page.goto('/')
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
    if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }))
  })
  await page.goto('/#/shows/1')
  await page.reload()
  await expect(heading(page)).toHaveText(SHOW)
  expect(await page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true)
  await context.close()
})

test('service banner replaces pills: strip with Retry and Settings, re-ping, clears when the service returns (criterion 10)', async ({ page }) => {
  let sonarrDown = true
  await page.route('**/api/sonarr/ping', route => sonarrDown ? route.fulfill({ status: 503, json: { error: 'down' } }) : route.continue())
  await open(page, '/shows')
  await expect(page.getByText("Can't reach Sonarr")).toBeVisible()
  await expect(page.locator('.service-pill, .status-dot')).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Settings' }).first()).toBeVisible()
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Movies' }).click()
  await expect(heading(page)).toHaveText('Movies')
  await expect(page.getByText("Can't reach Sonarr")).toHaveCount(0)
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Shows' }).click()
  await expect(page.getByText("Can't reach Sonarr")).toBeVisible()
  let pings = 0
  page.on('request', request => { if (request.url().endsWith('/api/sonarr/ping')) pings++ })
  sonarrDown = false
  await page.getByRole('button', { name: 'Retry Sonarr' }).click()
  await expect.poll(() => pings).toBeGreaterThan(0)
  await expect(page.getByText("Can't reach Sonarr")).toHaveCount(0)
})

test('bar switches at exactly 640 px: top bar from 640, bottom bar at 639 (criteria 8, 9)', async ({ browser }) => {
  for (const [width, bottom] of [[320, true], [402, true], [639, true], [640, false], [834, false], [1440, false]]) {
    const context = await browser.newContext({ viewport: { width, height: 800 }, ignoreHTTPSErrors: true })
    const page = await context.newPage()
    await open(page, '/shows')
    const nav = page.getByRole('navigation', { name: 'Main navigation' })
    const box = await nav.boundingBox()
    expect(await nav.getByRole('link').evaluateAll(els => els.map(el => el.textContent.trim()))).toEqual(['Downloads', 'Shows', 'Upcoming', 'Movies', 'Search'])
    await expect(nav.getByRole('link', { name: 'Shows' })).toHaveAttribute('aria-current', 'page')
    if (bottom) {
      expect(box.y + box.height).toBe(800)
      await expect(page.locator('.m-topbar')).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Add Show', exact: true })).toHaveText('')
      await expect(page.getByRole('link', { name: 'Settings', exact: true })).toHaveCount(1)
      const content = await page.locator('.m-main').evaluate(el => parseFloat(getComputedStyle(el).paddingBottom))
      expect(content).toBeGreaterThanOrEqual(box.height)
    } else {
      expect(box.y).toBeLessThan(60)
      await expect(page.locator('.m-bottomnav')).toHaveCount(0)
      await expect(page.locator('.m-topbar').getByRole('link', { name: 'ArrView' })).toHaveAttribute('href', '#/downloads')
      await expect(page.locator('.m-topbar').getByRole('link', { name: 'Settings', exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Add Show', exact: true })).toHaveText('Add Show')
    }
    await context.close()
  }
})

test('views: Large, Small and List persist per section and survive reload; Small has about twice the columns (criteria 13, 14, 22)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  for (const [section, key, hash] of [['shows', 'shows.view', '/shows'], ['movies', 'movies.view', '/movies']]) {
    await open(page, hash)
    const columns = () => page.locator('.m-grid').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length)
    await expect(page.getByRole('button', { name: 'Large posters' })).toHaveAttribute('aria-pressed', 'true')
    const large = await columns()
    await page.getByRole('button', { name: 'Small posters' }).click()
    const small = await columns()
    expect(small).toBeGreaterThanOrEqual(large * 1.7)
    expect(await page.evaluate(k => localStorage.getItem(`arrview.ui.v1.${k}`), key)).toBe('"small"')
    await page.reload()
    await expect(page.getByRole('button', { name: 'Small posters' })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.m-tile-title')).toHaveCount(0)
    const title = section === 'shows' ? SHOW : MOVIE
    await expect(page.getByRole('link', { name: title })).toHaveAttribute('title', title)
    await page.getByRole('button', { name: 'List' }).click()
    await page.reload()
    await expect(page.locator('.m-list')).toBeVisible()
    await expect(page.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true')
  }
  expect(await page.evaluate(() => localStorage.getItem('arrview.ui.v1.shows.view'))).toBe('"list"')
  await page.evaluate(() => localStorage.setItem('arrview.ui.v1.movies.view', '"bogus"'))
  await page.reload()
  await expect(page.getByRole('button', { name: 'Large posters' })).toHaveAttribute('aria-pressed', 'true')
})

test('show page: hero geometry, clamp, ambient layer, seasons and the three still fallbacks (criteria 16 to 21)', async ({ page }) => {
  for (const width of [1024, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await open(page, '/shows/1')
    const title = await heading(page).boundingBox()
    const art = await page.locator('.m-hero-art').boundingBox()
    expect(title.x + title.width).toBeLessThanOrEqual(art.x + 1)
    expect(art.x).toBeGreaterThan(width / 3)
  }
  expect(await page.locator('.m-overview').evaluate(el => getComputedStyle(el).webkitLineClamp)).toBe('3')
  await expect(page.locator('img.m-ambient')).toHaveCount(1)
  await expect(page.locator('.m-hero-art img')).toHaveAttribute('src', /arrview-icon\.svg$/)
  await expect(page.getByText('Fixture Network · Drama · Mystery · Thriller · Continuing').or(page.getByText(/2024 · Fixture Network · Drama · Mystery · Thriller · Continuing/))).toBeVisible()
  await expect(page.getByRole('button', { name: 'Season 1', exact: true })).toHaveAttribute('aria-pressed', 'true')
  const rows = page.locator('.m-ep')
  await expect(rows).toHaveCount(3)
  const still = await rows.first().locator('.m-art-still').boundingBox()
  expect(Math.abs(still.width / still.height - 16 / 9)).toBeLessThan(0.02)
  await expect(rows.nth(1).locator('.m-still img')).toHaveAttribute('src', /arrview-icon\.svg$/)
  await expect(page.locator('.m-ep.is-downloaded .m-runtime')).toHaveText('42m')
  await expect(page.locator('.m-ep.is-missing .m-runtime')).toHaveCount(0)
  expect(await rows.nth(1).locator('img').evaluate(el => getComputedStyle(el).filter)).toContain('grayscale')
  await expect(rows.first().getByRole('button')).toHaveCount(0)
  expect(await rows.first().locator('.m-ep-overview').count()).toBe(0)
  expect(await rows.nth(2).locator('.m-ep-overview').evaluate(el => getComputedStyle(el).webkitLineClamp)).toBe('2')
})
// Contexts that intercept images block the service worker, which would otherwise answer from its precache.
const blocked = (browser, options = {}) => browser.newContext({ serviceWorkers: 'block', ignoreHTTPSErrors: true, viewport: { width: 1280, height: 900 }, ...options })
test('all artwork broken: every box falls back to its neutral placeholder (criteria 17, 20)', async ({ browser }) => {
  const context = await blocked(browser)
  const page = await context.newPage()
  await page.route('**/arrview-icon.svg', route => route.abort())
  await page.route('**/__fixture/broken.png', route => route.abort())
  await open(page, '/shows/1')
  await expect(page.locator('.m-hero-art .m-art-empty')).toBeVisible()
  await expect(page.locator('.m-still .m-art-empty')).toHaveCount(3)
  await expect(page.locator('img.m-ambient')).toHaveCount(0)
  await page.goto('/#/movies/2')
  await expect(page.locator('.m-movie-poster .m-art-empty')).toBeVisible()
  await context.close()
})
test('hero layout on phones: art on top, text below (criterion 17)', async ({ page }) => {
  await page.setViewportSize({ width: 402, height: 800 })
  await open(page, '/shows/1')
  const title = await heading(page).boundingBox()
  const art = await page.locator('.m-hero-art').boundingBox()
  expect(art.y).toBeLessThan(title.y)
  expect(art.width).toBeGreaterThan(300)
  await expect(page.getByRole('link', { name: 'Back to TV Shows' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Settings', exact: true })).toBeVisible()
})
test('show page actions: Search Missing, Monitored, Open in Sonarr, More sheet with Cancel making no request (criterion 18)', async ({ page, request }) => {
  await open(page, '/shows/1')
  await request.post('/__fixture/reset-requests')
  const link = page.getByRole('link', { name: 'Open in Sonarr' })
  await expect(link).toHaveAttribute('target', '_blank')
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  await page.getByRole('button', { name: 'More actions for ' + SHOW }).click()
  await expect(page.getByRole('dialog').getByText('Remove series from Sonarr?')).toBeVisible()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect((await (await request.get('/__fixture/requests')).json()).filter(r => r.method !== 'GET')).toEqual([])
  await page.getByRole('button', { name: 'Search Missing' }).click()
  await expect.poll(async () => (await (await request.get('/__fixture/requests')).json()).some(r => r.method === 'POST' && r.path.includes('/command'))).toBe(true)
  await page.getByRole('button', { name: 'Monitored: ' + SHOW }).click()
  await expect.poll(async () => (await (await request.get('/__fixture/requests')).json()).some(r => r.method === 'PUT')).toBe(true)
})
test('movie page, release dates and the tile overlay on hover-capable pointers (criteria 23, 25)', async ({ page }) => {
  await twoMovies(page)
  await page.setViewportSize({ width: 1280, height: 900 })
  await open(page, '/movies')
  await expect(page.getByRole('link', { name: 'Upcoming fixture movie' })).toBeVisible()
  await expect(page.locator('.m-tilewrap', { hasText: 'Upcoming fixture movie' }).locator('.m-tile-meta')).toHaveText(/^Digital /)
  await expect(page.locator('.m-tilewrap', { hasText: MOVIE }).locator('.m-tile-meta')).toHaveText('Missing')
  const overlay = page.locator('.m-tilewrap', { hasText: MOVIE }).locator('.m-overlay')
  await expect(overlay).toHaveCSS('opacity', '0')
  await page.locator('.m-tilewrap', { hasText: MOVIE }).hover()
  await expect(overlay).toHaveCSS('opacity', '1')
  await expect(overlay.getByRole('button')).toHaveCount(4)
  await page.mouse.move(0, 0)
  await page.getByRole('link', { name: MOVIE }).focus()
  await expect(overlay).toHaveCSS('opacity', '1')
  await page.getByRole('link', { name: 'Upcoming fixture movie' }).click({ position: { x: 8, y: 8 } })
  await expect(heading(page)).toHaveText('Upcoming fixture movie')
  await expect(page.locator('.m-statusline')).toHaveText(/^Digital /)
  await open(page, '/movies/2')
  await expect(page.locator('.m-movie-poster img')).toBeVisible()
  await expect(page.locator('.m-statusline')).toHaveText('Missing')
  expect(await page.locator('.m-overview').evaluate(el => getComputedStyle(el).webkitLineClamp)).toBe('3')
  await page.getByRole('button', { name: 'Delete…' }).click()
  await expect(page.getByRole('dialog').getByText('Delete movie?')).toBeVisible()
})
for (const [view, size] of [['Large posters', 'large'], ['Small posters', 'small']]) {
  test(`${size} tile overlay: Download is compact, only the buttons act, any other click opens the movie (rework 2)`, async ({ page, request }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await open(page, '/movies')
    await page.getByRole('button', { name: view }).click()
    await expect(page.getByRole('button', { name: view })).toHaveAttribute('aria-pressed', 'true')
    const wrap = page.locator('.m-tilewrap').filter({ has: page.getByRole('link', { name: MOVIE }) })
    const poster = wrap.locator('.m-poster')
    const download = wrap.locator('.m-overlay').getByRole('button', { name: 'Download' })
    const commands = async () => (await (await request.get('/__fixture/requests')).json()).filter(r => r.method === 'POST' && r.path.includes('/command'))
    await request.post('/__fixture/reset-requests')
    await wrap.hover()
    await expect(wrap.locator('.m-overlay')).toHaveCSS('opacity', '1')
    const tile = await poster.boundingBox()
    const button = await download.boundingBox()
    expect(button.width).toBeLessThan(tile.width)
    if (size === 'large') expect(button.width).toBeLessThan(tile.width * 0.8)
    await expect(download).toHaveCSS('border-top-width', '0px')
    // A click in the lower half of the poster, outside every overlay button and right beside Download,
    // opens the movie page and starts nothing. The point is derived from the tile and button boxes.
    const boxes = []
    for (const b of await wrap.locator('.m-overlay').getByRole('button').all()) boxes.push(await b.boundingBox())
    const gap = 4
    const inside = (p, r, pad = 0) => p.x >= r.x - pad && p.x <= r.x + r.width + pad && p.y >= r.y - pad && p.y <= r.y + r.height + pad
    const cy = button.y + button.height / 2
    const candidates = [
      { x: button.x - gap - 2, y: cy },
      { x: button.x + button.width + gap + 2, y: cy },
      { x: button.x + button.width / 2, y: button.y - gap - 2 },
      { x: button.x + button.width / 2, y: button.y + button.height + gap + 2 },
      { x: tile.x + tile.width / 2, y: tile.y + tile.height * 0.75 }
    ]
    const point = candidates.find(p => inside(p, tile) && p.y > tile.y + tile.height / 2 && !boxes.some(r => inside(p, r, gap)))
    expect(point, 'a click point in the lower half of the tile outside every overlay button').toBeTruthy()
    expect(inside(point, tile)).toBe(true)
    expect(point.y).toBeGreaterThan(tile.y + tile.height / 2)
    for (const r of boxes) expect(inside(point, r)).toBe(false)
    await page.mouse.click(point.x, point.y)
    await expect(heading(page)).toHaveText(MOVIE)
    expect(await commands()).toEqual([])
    await open(page, '/movies')
    await wrap.hover()
    await expect(download).toBeVisible()
    await download.click()
    await expect.poll(async () => (await commands()).length).toBe(1)
    await page.waitForTimeout(300)
    expect((await commands()).length).toBe(1)
    await expect(page).toHaveURL(/#\/movies$/)
  })
}
test('touch pointers: no overlay buttons in the DOM, tiles are plain links (criterion 23)', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 402, height: 800 }, hasTouch: true, isMobile: true, ignoreHTTPSErrors: true })
  const page = await context.newPage()
  await open(page, '/movies')
  await expect(page.getByRole('link', { name: MOVIE })).toBeVisible()
  await expect(page.locator('.m-overlay')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Interactive Search' })).toHaveCount(0)
  await page.getByRole('link', { name: MOVIE }).tap()
  await expect(heading(page)).toHaveText(MOVIE)
  await context.close()
})

test('no horizontal overflow on any Modern page at the standard widths (criterion 28)', async ({ browser }) => {
  for (const width of [320, 402, 466, 669, 834, 1024, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 800 }, ignoreHTTPSErrors: true })
    const page = await context.newPage()
    const check = async (label) => expect(await fits(page), `${label} at ${width}px`).toBe(true)
    await open(page, '/downloads'); await check('downloads')
    for (const view of ['Large posters', 'Small posters', 'List']) {
      await open(page, '/shows'); await page.getByRole('button', { name: view }).click(); await expect(page.getByRole('button', { name: view })).toHaveAttribute('aria-pressed', 'true'); await check(`shows ${view}`)
      await open(page, '/movies'); await page.getByRole('button', { name: view }).click(); await expect(page.getByRole('button', { name: view })).toHaveAttribute('aria-pressed', 'true'); await check(`movies ${view}`)
    }
    await open(page, '/shows/1'); await expect(page.locator('.m-ep').first()).toBeVisible(); await check('show page')
    await open(page, '/upcoming'); await check('upcoming')
    await open(page, '/movies/2'); await check('movie page')
    await open(page, '/search'); await check('search')
    await open(page, '/settings'); await check('settings')
    await open(page, '/shows/999'); await expect(page.getByText('That show could not be found.')).toBeVisible(); await check('not found')
    await context.close()
  }
})

test('reduced motion zeroes Modern transitions and animations (criterion 29)', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce', ignoreHTTPSErrors: true })
  const page = await context.newPage()
  await open(page, '/movies')
  for (const selector of ['.m-topbar', '.m-tile', '.m-overlay', '.m-viewtoggle button']) {
    const durations = await page.locator(selector).first().evaluate(el => { const s = getComputedStyle(el); return [s.transitionDuration, s.animationDuration] })
    for (const value of durations) expect(value.split(',').every(part => part.trim() === '0s'), `${selector}: ${value}`).toBe(true)
  }
  await open(page, '/shows/1')
  for (const selector of ['.m-topbar', '.m-hero', '.m-hero-art', '.m-ep']) {
    const durations = await page.locator(selector).first().evaluate(el => { const s = getComputedStyle(el); return [s.transitionDuration, s.animationDuration] })
    for (const value of durations) expect(value.split(',').every(part => part.trim() === '0s'), `${selector}: ${value}`).toBe(true)
  }
  await context.close()
})

test('tile grid does not shift when images arrive (criterion 27)', async ({ browser }) => {
  const context = await blocked(browser)
  const page = await context.newPage()
  let release
  const gate = new Promise(resolve => { release = resolve })
  await page.route('**/arrview-icon.svg', async route => { await gate; await route.continue() })
  await open(page, '/movies')
  const measure = () => page.locator('.m-tilewrap').first().evaluate(el => { const a = el.querySelector('.m-art').getBoundingClientRect(), b = el.querySelector('.m-tile-title').getBoundingClientRect(); return [a.top, a.height, b.top] })
  const before = await measure()
  expect(before[1]).toBeGreaterThan(100)
  release()
  await expect.poll(() => page.locator('.m-art img').first().evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true)
  expect(await measure()).toEqual(before)
  await expect(page.locator('.m-art img').first()).toHaveAttribute('loading', 'lazy')
  await context.close()
})

// Focus order, 44 px targets and the neutral focus ring.
async function walk(page, count) {
  const seen = []
  for (let i = 0; i < count; i++) {
    await page.keyboard.press('Tab')
    if (await page.evaluate(() => document.activeElement === document.body)) break
    seen.push(await page.evaluate(() => {
      const el = document.activeElement, box = el.getBoundingClientRect(), style = getComputedStyle(el)
      return { name: el.getAttribute('aria-label') || el.textContent.replace(/\s+/g, ' ').trim(), width: box.width, height: box.height, outline: `${style.outlineWidth} ${style.outlineStyle} ${style.outlineColor}`, color: style.outlineColor, inMain: Boolean(el.closest('main')) }
    }))
  }
  return seen
}
const mainFocusables = page => page.locator('main').locator('a[href], button:not([disabled]), input, select, [tabindex]:not([tabindex="-1"])').evaluateAll(els => els.map(el => el.getAttribute('aria-label') || el.textContent.replace(/\s+/g, ' ').trim()))
const SHOW_SEQUENCE = ['Search Missing', 'Monitored: ' + SHOW, 'Open in Sonarr', 'More actions for ' + SHOW, 'Season 1', 'Search 1 Missing', 'More actions for Season 1',
  'Download', 'Interactive search — pick a release manually', 'Delete and unmonitor ' + EP_DOWNLOADED]
for (const [width, phone] of [[1024, false], [402, true]]) {
  test(`focus order on the show and movie pages (${width}px) (criterion 31)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await open(page, '/shows/1')
    const expected = ['Back to TV Shows', ...(phone ? ['Settings'] : []), ...SHOW_SEQUENCE]
    expect(await mainFocusables(page)).toEqual(expected)
    expect(await page.locator('main [tabindex]').evaluateAll(els => els.map(el => Number(el.getAttribute('tabindex'))).filter(n => n > 0))).toEqual([])
    await page.getByRole('link', { name: 'Back to TV Shows' }).focus()
    const tabbed = ['Back to TV Shows', ...(await walk(page, expected.length - 1)).map(item => item.name)]
    expect(tabbed).toEqual(expected)
    await open(page, '/movies/2')
    const movie = ['Back to Movies', ...(phone ? ['Settings'] : []), 'Download', 'Interactive Search', 'Monitored: ' + MOVIE, 'Delete…']
    expect(await mainFocusables(page)).toEqual(movie)
    await page.getByRole('link', { name: 'Back to Movies' }).focus()
    expect(['Back to Movies', ...(await walk(page, movie.length - 1)).map(item => item.name)]).toEqual(movie)
  })
}
test('coarse pointers: every focusable Modern control is at least 44 x 44 with the neutral ring (criterion 30)', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 402, height: 800 }, hasTouch: true, isMobile: true, ignoreHTTPSErrors: true })
  const page = await context.newPage()
  for (const hash of ['/shows/1', '/movies', '/shows', '/movies/2']) {
    await open(page, hash)
    const items = await walk(page, (await page.locator('main a[href], main button, main input, main select, nav a[href]').count()) + 2)
    expect(items.length).toBeGreaterThan(5)
    const seen = new Set()
    for (const item of items) {
      if (seen.has(item.name)) continue
      seen.add(item.name)
      expect(item.width, `${hash} ${item.name}`).toBeGreaterThanOrEqual(43.9)
      expect(item.height, `${hash} ${item.name}`).toBeGreaterThanOrEqual(43.9)
      expect(item.outline, `${hash} ${item.name}`).toMatch(/^2px solid/)
      expect(item.color, `${hash} ${item.name}`).toBe(TEXT)
      expect(item.color).not.toBe(LIVE)
    }
  }
  await open(page, '/shows/1')
  await page.getByRole('button', { name: 'More actions for ' + SHOW }).tap()
  for (const button of await page.getByRole('dialog').getByRole('button').all()) {
    const box = await button.boundingBox()
    expect(box.width).toBeGreaterThanOrEqual(43.9); expect(box.height).toBeGreaterThanOrEqual(43.9)
  }
  await context.close()
})
test('the neutral focus ring also covers reused Downloads controls on wide screens (criteria 11, 30)', async ({ page }) => {
  await open(page, '/downloads')
  await page.getByRole('button', { name: 'Refresh downloads' }).focus()
  await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab')
  const color = await page.evaluate(() => getComputedStyle(document.activeElement).outlineColor)
  expect(color).toBe(TEXT)
  expect(color).not.toBe(LIVE)
  const css = await page.evaluate(async () => [...document.styleSheets].flatMap(sheet => [...sheet.cssRules]).map(rule => rule.cssText).filter(text => text.startsWith('.m-shell :focus-visible')))
  expect(css.length).toBe(1)
})
// Tab through the open dialog with the keyboard and report each focused control's focus ring colour.
async function dialogRingColours(page) {
  const colours = []
  const count = Math.min(await page.getByRole('dialog').locator('button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href]').count(), 4)
  expect(count).toBeGreaterThan(1)
  let key = 'Tab'
  for (let i = 0; i < count; i++) {
    await page.keyboard.press(key)
    if (!await page.evaluate(() => document.activeElement.closest('dialog') !== null)) { key = 'Shift+Tab'; await page.keyboard.press(key) }
    const info = await page.evaluate(() => ({ inDialog: document.activeElement.closest('dialog') !== null, tag: document.activeElement.tagName, color: getComputedStyle(document.activeElement).outlineColor, style: getComputedStyle(document.activeElement).outlineStyle }))
    if (!info.inDialog) break
    colours.push(info)
  }
  expect(colours.length).toBeGreaterThan(0)
  return colours
}
test('sheets opened from Modern use the neutral focus ring; Classic sheets stay cyan (criterion 30)', async ({ page }) => {
  await open(page, '/shows/1')
  await page.getByRole('button', { name: 'More actions for ' + SHOW }).click()
  await expect(page.getByRole('dialog').getByText('Remove series from Sonarr?')).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveClass(/m-sheet/)
  let colours = await dialogRingColours(page)
  expect(colours.some(c => c.tag === 'BUTTON')).toBe(true)
  for (const c of colours) { expect(c.style).toBe('solid'); expect(c.color).toBe(TEXT); expect(c.color).not.toBe(LIVE) }
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await open(page, '/shows')
  await page.getByRole('button', { name: 'Add Show', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  colours = await dialogRingColours(page)
  // The initially focused search input and every select must draw a solid neutral outline and no cyan border.
  const focusInfo = () => page.evaluate(() => { const s = getComputedStyle(document.activeElement); return { tag: document.activeElement.tagName, style: s.outlineStyle, width: s.outlineWidth, color: s.outlineColor, border: s.borderTopColor } })
  // The dialog opens with focus on a button, not the search input, so focus the input explicitly.
  await page.getByRole('dialog').locator('input[type="text"]').first().focus()
  await expect(page.getByRole('dialog').locator('input[type="text"]').first()).toBeFocused()
  const search = await focusInfo()
  expect(search.tag).toBe('INPUT')
  expect(search).toMatchObject({ style: 'solid', width: '2px', color: TEXT })
  expect(search.border).not.toBe(LIVE)
  await page.getByPlaceholder('Search for a tv show…').fill('fixture')
  await page.getByRole('button', { name: 'Select A long fixture lookup result with descriptive text' }).click()
  const selects = page.getByRole('dialog').locator('select:not([disabled])')
  const selectCount = await selects.count()
  expect(selectCount).toBeGreaterThan(0)
  for (let i = 0; i < selectCount; i++) {
    await selects.nth(i).focus()
    const info = await focusInfo()
    expect(info.tag).toBe('SELECT')
    expect(info).toMatchObject({ style: 'solid', width: '2px', color: TEXT })
    expect(info.border).not.toBe(LIVE)
  }
  colours = await dialogRingColours(page)
  for (const c of colours) { expect(c.style).toBe('solid'); expect(c.color).toBe(TEXT) }
  await page.keyboard.press('Escape')
  await page.evaluate(() => localStorage.setItem('arrview.ui.v1.layout', '"classic"'))
  await page.reload()
  await page.getByRole('button', { name: 'Movies', exact: true }).click()
  await page.getByRole('button', { name: '+ Add Movie', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('dialog')).not.toHaveClass(/m-sheet/)
  colours = await dialogRingColours(page)
  expect(colours.some(c => c.color === LIVE)).toBe(true)
  for (const c of colours) if (c.style === 'solid') expect(c.color).toBe(LIVE)
  // Classic sheet text input is unchanged: global rule removes the outline and draws the cyan border.
  await page.getByRole('dialog').locator('input[type="text"]').first().focus()
  await expect(page.getByRole('dialog').locator('input[type="text"]').first()).toBeFocused()
  expect(await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle)).toBe('none')
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.activeElement).borderTopColor)).toBe(LIVE)
})
test('the active phone tab uses the fill icon and inactive tabs the regular one (criterion 8)', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 402, height: 800 }, hasTouch: true, isMobile: true, ignoreHTTPSErrors: true })
  const page = await context.newPage()
  const iconPath = name => page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name, exact: true }).locator('svg path').getAttribute('d')
  await open(page, '/shows')
  const showsActive = await iconPath('Shows'); const moviesInactive = await iconPath('Movies')
  await open(page, '/movies')
  const showsInactive = await iconPath('Shows'); const moviesActive = await iconPath('Movies')
  expect(showsActive).not.toBe(showsInactive)
  expect(moviesActive).not.toBe(moviesInactive)
  await context.close()
})
test('a deep link to a show or movie before the library loads ends with focus on the real <h1> (criterion 31)', async ({ page }) => {
  for (const [kind, api, title, hash] of [['shows', 'sonarr/series', SHOW, '/shows/1'], ['movies', 'radarr/movies', MOVIE, '/movies/2']]) {
    await open(page, '/downloads')
    let release
    const gate = new Promise(resolve => { release = resolve })
    await page.route(`**/api/${api}`, async route => { await gate; await route.continue() })
    await page.evaluate(h => { window.location.hash = h }, hash)
    await expect(page.getByText(kind === 'shows' ? 'Loading show…' : 'Loading movie…')).toBeVisible()
    release()
    await expect(heading(page)).toHaveText(title)
    await expect.poll(() => page.evaluate(() => document.activeElement === document.querySelector('.m-main h1'))).toBe(true)
    await page.unroute(`**/api/${api}`)
  }
})
test('Add buttons open the existing modals (criterion 9)', async ({ page }) => {
  await open(page, '/shows')
  await page.getByRole('button', { name: 'Add Show', exact: true }).click()
  await expect(page.getByPlaceholder('Search for a tv show…')).toBeVisible()
  await page.keyboard.press('Escape')
  await open(page, '/movies')
  await page.getByRole('button', { name: 'Add Movie', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
})
