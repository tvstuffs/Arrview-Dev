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
  await page.getByRole('link', { name: new RegExp(`^${SHOW}, season 1, episode 2,`) }).click()
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
  await expect(page.locator('.m-season-name')).toHaveText('Season 1')
  await expect(page.getByRole('combobox', { name: 'Season' })).toHaveCount(0)
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
  await page.getByRole('button', { name: 'Remove ' + SHOW + ' from Sonarr' }).click()
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
const SHOW_SEQUENCE = ['Search Missing', 'Monitored: ' + SHOW, 'Open in Sonarr', 'Remove ' + SHOW + ' from Sonarr', 'Monitored, Season 1. Press to unmonitor', 'Search 1 Missing', 'Delete downloaded files in Season 1',
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
  await page.getByRole('button', { name: 'Remove ' + SHOW + ' from Sonarr' }).tap()
  for (const button of await page.getByRole('dialog').getByRole('button').all()) {
    const box = await button.boundingBox()
    expect(box.width).toBeGreaterThanOrEqual(43.9); expect(box.height).toBeGreaterThanOrEqual(43.9)
  }
  await context.close()
})
test('the neutral focus ring also covers reused Downloads controls on wide screens (criteria 11, 30)', async ({ page }) => {
  await open(page, '/downloads')
  await page.getByRole('button', { name: 'Pause All' }).focus()
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
  await page.getByRole('button', { name: 'Remove ' + SHOW + ' from Sonarr' }).click()
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
  // The search input (focused on open) and every control after it must draw a solid neutral outline and no cyan border.
  const focusInfo = () => page.evaluate(() => { const s = getComputedStyle(document.activeElement); return { tag: document.activeElement.tagName, role: document.activeElement.getAttribute('role'), popup: document.activeElement.getAttribute('aria-haspopup'), style: s.outlineStyle, width: s.outlineWidth, color: s.outlineColor, border: s.borderTopColor } })
  await expect(page.getByRole('dialog').locator('input[type="text"]').first()).toBeFocused()
  const search = await focusInfo()
  expect(search.tag).toBe('INPUT')
  expect(search).toMatchObject({ style: 'solid', width: '2px', color: TEXT })
  expect(search.border).not.toBe(LIVE)
  await page.getByPlaceholder('Search for a tv show…').fill('fixture')
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Select A long fixture lookup result with descriptive text' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('dialog').getByRole('button', { name: /Quality Profile/ })).toContainText('Fixture Standard')
  // Walk the search field, a result, the two pickers and the two switches with the keyboard.
  const walked = []
  // Two selectable results (the third is already in the library and skipped), two pickers, two switches, then Cancel and Add.
  for (let i = 0; i < 8; i++) { await page.keyboard.press('Tab'); walked.push(await focusInfo()) }
  expect(walked.filter(w => w.tag === 'BUTTON' && w.popup === 'listbox')).toHaveLength(2)
  expect(walked.filter(w => w.role === 'switch')).toHaveLength(2)
  expect(walked.some(w => w.tag === 'BUTTON' && w.popup === null)).toBe(true) // a result
  for (const info of walked) { expect(info).toMatchObject({ style: 'solid', width: '2px', color: TEXT }); expect(info.border).not.toBe(LIVE) }
  colours = await dialogRingColours(page)
  for (const c of colours) { expect(c.style).toBe('solid'); expect(c.color).toBe(TEXT) }
  await page.keyboard.press('Escape')
  await page.evaluate(() => localStorage.setItem('arrview.ui.v1.layout', '"classic"'))
  await page.reload()
  await page.getByRole('button', { name: 'Movies', exact: true }).click()
  await page.getByRole('button', { name: '+ Add Movie', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('dialog')).not.toHaveClass(/m-sheet/)
  // Classic sheet text input is unchanged: global rule removes the outline and draws the cyan border.
  await expect(page.getByRole('dialog').locator('input[type="text"]').first()).toBeFocused()
  expect(await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle)).toBe('none')
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.activeElement).borderTopColor)).toBe(LIVE)
  colours = await dialogRingColours(page)
  expect(colours.some(c => c.color === LIVE)).toBe(true)
  for (const c of colours) if (c.style === 'solid') expect(c.color).toBe(LIVE)
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
    // Start on Search: the Downloads page now loads the series and movie lists for History matching, which would cache them.
    await open(page, '/search')
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
test('Settings: the Test button keeps its size while it shows a spinner, a check or an X, and says Test again after four seconds', async ({ browser }) => {
  const OK = 'rgb(126, 226, 160)', DANGER = 'rgb(255, 107, 107)'
  for (const [width, height] of [[1280, 900], [390, 844]]) {
    const context = await browser.newContext({ viewport: { width, height }, ignoreHTTPSErrors: true, serviceWorkers: 'block' })
    const page = await context.newPage()
    await open(page, '/settings')
    await page.getByRole('button', { name: 'Sonarr', exact: true }).click()
    const button = page.locator('#sonarr-panel .service-test')
    const field = page.locator('#sonarr-key')
    await button.scrollIntoViewIfNeeded()
    // Width and height of the button and of the key field beside it: the field moves if the button changes width.
    const sizes = async () => { const [b, f] = [await button.boundingBox(), await field.boundingBox()]; return [b.width, b.height, f.width, f.height] }
    const idle = await sizes()
    const unchanged = async label => { const now = await sizes(); now.forEach((value, i) => expect(Math.abs(value - idle[i]), `${label} at ${width} px, measure ${i}`).toBeLessThan(0.6)) }

    let release
    const gate = new Promise(resolve => { release = resolve })
    await page.route('**/api/test/sonarr', async route => { await gate; await route.fulfill({ json: { success: true, version: '4.0.20' } }) })
    await button.click()
    await expect(button).toHaveAttribute('aria-label', 'Testing')
    await expect(button.locator('.spinner')).toBeVisible()
    await unchanged('spinner')
    release()
    await expect(button).toHaveAttribute('aria-label', 'Test passed')
    await expect(button.locator('svg.icon')).toBeVisible()
    await expect(button.locator('.service-test-label')).toBeHidden()
    await expect.poll(() => button.evaluate(el => getComputedStyle(el).color)).toBe(OK)
    await expect(page.locator('#sonarr-status')).toHaveText('Connected · v4.0.20')
    await unchanged('check')
    if (width === 1280) {
      await expect.poll(() => button.getAttribute('aria-label'), { timeout: 6000 }).toBeNull()
      await expect(button.locator('.service-test-label')).toBeVisible()
      await expect(button.locator('svg')).toHaveCount(0)
      await unchanged('Test again')
    }

    // A wrong key: an X. Editing the key while the check still shows makes the button ready at once.
    await page.unroute('**/api/test/sonarr')
    await page.route('**/api/test/sonarr', route => route.fulfill({ status: 400, json: { error: 'HTTP 401: Unauthorized' } }))
    await field.fill('typed-wrong-key')
    await expect(button).not.toHaveAttribute('aria-disabled', 'true', { timeout: 500 })
    await button.click()
    await expect(button).toHaveAttribute('aria-label', 'Test failed')
    await expect(button.locator('svg.icon')).toBeVisible()
    await expect.poll(() => button.evaluate(el => getComputedStyle(el).color)).toBe(DANGER)
    await expect(page.locator('#sonarr-status')).toHaveText('Test failed')
    await expect(page.getByText('HTTP 401: Unauthorized', { exact: true })).toBeVisible()
    await unchanged('X')
    await context.close()
  }
})
test('Settings: an http address must name its port and an https address needs none, for SABnzbd and the others', async ({ browser }) => {
  const PORT_NOTE = 'Add the port, for example http://192.0.2.10:8080. An https:// address needs none.'
  for (const [width, height] of [[1280, 900], [390, 844]]) {
    const context = await browser.newContext({ viewport: { width, height }, ignoreHTTPSErrors: true, serviceWorkers: 'block' })
    const page = await context.newPage()
    const sent = []
    page.on('request', request => { if (request.method() === 'POST') sent.push(new URL(request.url()).pathname) })
    await open(page, '/settings')
    await page.getByRole('button', { name: 'SABnzbd', exact: true }).click()
    const url = page.locator('#sabnzbd-url'), key = page.locator('#sabnzbd-key'), note = page.locator('#sabnzbd-url-problem')
    const test = page.locator('#sabnzbd-panel .service-test')

    // A new address, typed: nothing is said while it is typed, the message comes when the field is left.
    await url.fill('http://192.0.2.10')
    await expect(note).toHaveCount(0)
    await key.fill('typed-key-1')
    await expect(note).toHaveText(PORT_NOTE)
    await expect(note).toHaveAttribute('role', 'alert')
    await expect(url).toHaveAttribute('aria-invalid', 'true')
    expect(await fits(page), `the message fits the page at ${width} px`).toBe(true)
    // Test and Save say why and send nothing.
    await expect(test).toHaveAttribute('aria-disabled', 'true')
    await test.click({ force: true })   // a person can click it: Playwright would refuse an aria-disabled button
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByText(`SABnzbd: ${PORT_NOTE}`, { exact: true })).toBeVisible()
    expect(sent, 'nothing was sent while the address had no port').toEqual([])

    // With the port the message goes and the address is tested exactly as typed.
    let tested = null
    await page.route('**/api/test/sabnzbd', async route => { tested = route.request().postDataJSON(); await route.fulfill({ json: { success: true, version: '5.1.3' } }) })
    await url.fill('http://192.0.2.10:8080')
    await expect(note).toHaveCount(0)
    await test.click()
    await expect(page.locator('#sabnzbd-status')).toHaveText('Connected · v5.1.3')
    expect(tested).toEqual({ url: 'http://192.0.2.10:8080', apikey: 'typed-key-1' })

    // An https address has no port to name, and none is added.
    await url.fill('https://sab.example.invalid')
    await key.focus()
    await expect(note).toHaveCount(0)
    await test.click()
    await expect.poll(() => tested.url).toBe('https://sab.example.invalid')

    // The other apps follow the same rule, each with its own usual port in the suggestion.
    for (const [id, name, port] of [['sonarr', 'Sonarr', 8989], ['radarr', 'Radarr', 7878], ['nzbhydra', 'NZBHydra', 5076]]) {
      await page.getByRole('button', { name, exact: true }).click()
      await page.locator(`#${id}-url`).fill('nas.example.invalid')
      await page.locator(`#${id}-key`).focus()
      await expect(page.locator(`#${id}-url-problem`)).toHaveText(`Add the port, for example http://nas.example.invalid:${port}. An https:// address needs none.`)
      await page.locator(`#${id}-url`).fill('https://nas.example.invalid')
      await page.locator(`#${id}-key`).focus()
      await expect(page.locator(`#${id}-url-problem`)).toHaveCount(0)
    }
    expect(await fits(page), `the page fits at ${width} px`).toBe(true)
    await context.close()
  }
})
test('Settings: Sonarr\'s address in the Radarr row is not Connected, and the Test names the app that answered (through the real server)', async ({ browser }) => {
  for (const [width, height] of [[1280, 900], [390, 844]]) {
    const context = await browser.newContext({ viewport: { width, height }, ignoreHTTPSErrors: true, serviceWorkers: 'block' })
    const page = await context.newPage()
    const saves = []
    page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/config') saves.push(request.url()) })
    await open(page, '/settings')
    // The fixture's upstream names itself under /as-sonarr and /as-radarr, as the real apps do in system/status.
    const row = async (id, name, path) => {
      const url = page.locator(`#${id}-url`)
      if (!(await url.isVisible())) await page.getByRole('button', { name, exact: true }).click()
      const upstream = new URL(await url.inputValue()).origin
      await url.fill(`${upstream}${path}`)
      await page.locator(`#${id}-key`).fill('typed-key-1')
      await page.locator(`#${id}-panel .service-test`).click()
    }

    await row('radarr', 'Radarr', '/as-sonarr')
    const button = page.locator('#radarr-panel .service-test')
    await expect(button).toHaveAttribute('aria-label', 'Test failed')
    await expect(page.locator('#radarr-status')).toHaveText('Test failed')
    await expect(page.getByText('That address is Sonarr, not Radarr — check the address and port', { exact: true })).toBeVisible()
    expect(await fits(page), `the message fits the page at ${width} px`).toBe(true)

    // The app the row is for: Connected, with the version it sent (the edit makes the button ready at once).
    await row('radarr', 'Radarr', '/as-radarr')
    await expect(page.locator('#radarr-status')).toHaveText('Connected · v6.4.4.10685')

    // And the other way round.
    await row('sonarr', 'Sonarr', '/as-radarr')
    await expect(page.locator('#sonarr-status')).toHaveText('Test failed')
    await expect(page.getByText('That address is Radarr, not Sonarr — check the address and port', { exact: true })).toBeVisible()
    expect(saves, 'a Test stores nothing').toEqual([])
    await context.close()
  }
})
test('Shows: an unmonitored season can be monitored and then searched as a whole season, in Modern and in Classic', async ({ browser, request }) => {
  const base = (await (await request.get('/api/sonarr/series')).json())[0]
  const day = n => new Date(Date.now() + n * 86400000).toISOString()
  for (const [width, height] of [[1280, 900], [390, 844]]) {
    const context = await browser.newContext({ viewport: { width, height }, ignoreHTTPSErrors: true, serviceWorkers: 'block' })
    const page = await context.newPage()
    // A season nobody monitors: three aired episodes without a file and one that has not aired. The stand-in for the server does
    // what the real route does in Sonarr: the season's flag and every episode of it.
    let monitored = false
    const sent = []
    const show = () => ({ ...base, images: [], seasons: [{ seasonNumber: 1, monitored, statistics: { totalEpisodeCount: 4, episodeFileCount: 0, episodeCount: monitored ? 3 : 0 } }] })
    const episodes = () => [1, 2, 3, 4].map(n => ({ id: 500 + n, seriesId: base.id, seasonNumber: 1, episodeNumber: n, title: `Season fixture episode ${n}`, hasFile: false, monitored, airDateUtc: day(n === 4 ? 10 : -10 * n) }))
    await page.route('**/api/sonarr/series', route => route.fulfill({ json: [show()] }))
    await page.route(`**/api/sonarr/series/${base.id}/episodes`, route => route.fulfill({ json: episodes() }))
    await page.route(`**/api/sonarr/series/${base.id}/season/1`, route => {
      sent.push({ method: route.request().method(), body: route.request().postDataJSON() })
      monitored = route.request().postDataJSON().monitored
      return route.fulfill({ json: { success: true, monitored } })
    })
    await page.route('**/api/sonarr/command', route => { sent.push({ method: 'POST', body: route.request().postDataJSON() }); return route.fulfill({ json: { id: 99 } }) })

    await open(page, `/shows/${base.id}`)
    const bar = page.locator('.m-season-bar')
    await expect(bar).toContainText('0 of 4 episodes · 3 missing are unmonitored')
    await expect(bar.getByRole('button', { name: /Search \d+ Missing/ })).toHaveCount(0)
    expect(await fits(page), `the season bar fits at ${width} px`).toBe(true)
    await bar.getByRole('button', { name: 'Monitor season 1' }).click()
    await expect(bar.getByRole('button', { name: 'Monitored, Season 1. Press to unmonitor' })).toBeVisible()
    await expect(bar).not.toContainText('unmonitored')
    await bar.getByRole('button', { name: 'Search 3 Missing' }).click()
    await expect.poll(() => sent.length).toBe(2)
    expect(sent).toEqual([{ method: 'PUT', body: { monitored: true } }, { method: 'POST', body: { name: 'SeasonSearch', seriesId: base.id, seasonNumber: 1 } }])
    expect(await fits(page), `the season bar fits at ${width} px once monitored`).toBe(true)

    // Classic: the same control in the season's header, here used to unmonitor the season again.
    await page.evaluate(() => { localStorage.setItem('arrview.ui.v1.layout', '"classic"'); localStorage.setItem('arrview.ui.v1.tab', '"shows"') })
    await page.goto('/')
    await page.getByRole('button', { name: `Episodes for ${base.title}` }).click()
    const header = page.locator('.season-header')
    await header.getByRole('button', { name: 'Monitored, Season 1. Press to unmonitor' }).click()
    await expect(header.getByRole('button', { name: 'Monitor season 1' })).toBeVisible()
    await expect(header).toContainText('0/4 episodes · 3 missing unmonitored')
    await expect(header.getByRole('button', { name: /Search \d+ Missing/ })).toHaveCount(0)
    expect(sent.at(-1)).toEqual({ method: 'PUT', body: { monitored: false } })
    expect(await fits(page), `the Classic season header fits at ${width} px`).toBe(true)
    await context.close()
  }
})
test('Shows: every season of a show can be monitored in one press, in Modern and in Classic', async ({ browser, request }) => {
  const base = (await (await request.get('/api/sonarr/series')).json())[0]
  const day = n => new Date(Date.now() + n * 86400000).toISOString()
  for (const [width, height] of [[1280, 900], [390, 844]]) {
    const context = await browser.newContext({ viewport: { width, height }, ignoreHTTPSErrors: true, serviceWorkers: 'block' })
    const page = await context.newPage()
    // A show with three seasons nobody monitors. The stand-in for the server does what the real route does in Sonarr: the flag of
    // every season and every episode in them.
    let monitored = false
    const sent = []
    const show = () => ({ ...base, images: [], seasons: [1, 2, 3].map(seasonNumber => ({ seasonNumber, monitored, statistics: { totalEpisodeCount: 2, episodeFileCount: 0, episodeCount: monitored ? 2 : 0 } })) })
    const episodes = () => [1, 2, 3].flatMap(sn => [1, 2].map(n => ({ id: sn * 100 + n, seriesId: base.id, seasonNumber: sn, episodeNumber: n, title: `Seasons fixture episode ${sn}.${n}`, hasFile: false, monitored, airDateUtc: day(-10 * n) })))
    await page.route('**/api/sonarr/series', route => route.fulfill({ json: [show()] }))
    await page.route(`**/api/sonarr/series/${base.id}/episodes`, route => route.fulfill({ json: episodes() }))
    await page.route(`**/api/sonarr/series/${base.id}/seasons`, route => {
      sent.push({ method: route.request().method(), body: route.request().postDataJSON() })
      monitored = route.request().postDataJSON().monitored
      return route.fulfill({ json: { success: true, monitored, seasons: 3 } })
    })

    await open(page, `/shows/${base.id}`)
    const head = page.locator('.m-seasons-head')
    await expect(head.getByRole('heading', { name: 'Episodes' })).toBeVisible()
    expect(await fits(page), `the Episodes heading fits at ${width} px`).toBe(true)
    await head.getByRole('button', { name: `Monitor all seasons of ${base.title}` }).click()
    await expect(head.getByRole('button', { name: `All seasons monitored for ${base.title}. Press to unmonitor them` })).toBeVisible()
    expect(sent).toEqual([{ method: 'PUT', body: { monitored: true } }])
    // The picked season's own control follows what was done to every season.
    await expect(page.locator('.m-season-bar').getByRole('button', { name: /^Monitored, Season \d\. Press to unmonitor$/ })).toBeVisible()
    expect(await fits(page), `the Episodes heading fits at ${width} px once monitored`).toBe(true)

    // Classic: the control above the seasons, here used to unmonitor them all again.
    await page.evaluate(() => { localStorage.setItem('arrview.ui.v1.layout', '"classic"'); localStorage.setItem('arrview.ui.v1.tab', '"shows"') })
    await page.goto('/')
    await page.getByRole('button', { name: `Episodes for ${base.title}` }).click()
    const classicHead = page.locator('.show-seasons-head')
    await classicHead.getByRole('button', { name: `All seasons monitored for ${base.title}. Press to unmonitor them` }).click()
    await expect(classicHead.getByRole('button', { name: `Monitor all seasons of ${base.title}` })).toBeVisible()
    expect(sent.at(-1)).toEqual({ method: 'PUT', body: { monitored: false } })
    expect(await fits(page), `the Classic control fits at ${width} px`).toBe(true)
    await context.close()
  }
})
test('Shows: the bar, the caption and the missing count follow what Sonarr wants, in Modern and in Classic', async ({ page, request }) => {
  const OK = 'rgb(126, 226, 160)', DANGER = 'rgb(255, 107, 107)'
  const base = (await (await request.get('/api/sonarr/series')).json())[0]
  // Delta: 10 episodes, 5 wanted, 4 on disk. Epsilon: 187 episodes, nothing monitored. Zeta: 100 episodes, 9 wanted, none on disk.
  const show = (id, title, total, onDisk, wanted) => ({ ...base, id, title, titleSlug: title.toLowerCase().replace(/ /g, '-'), monitored: true, images: [],
    seasons: [{ seasonNumber: 1, statistics: { totalEpisodeCount: total, episodeFileCount: onDisk, episodeCount: wanted } }] })
  await page.route('**/api/sonarr/series', route => route.fulfill({ json: [show(11, 'Delta Show', 10, 4, 5), show(12, 'Epsilon Show', 187, 0, 0), show(13, 'Zeta Show', 100, 0, 9)] }))
  await open(page, '/shows')
  await expect(page.locator('.m-meta')).toContainText('10 missing episodes')
  const fill = title => page.locator('a.m-tile', { hasText: title }).locator('.m-tilebar span')
  await expect(fill('Delta Show')).toHaveCSS('background-color', OK)
  expect(await fill('Delta Show').evaluate(el => el.style.width)).toBe('80%')
  await expect(fill('Zeta Show')).toHaveCSS('background-color', DANGER)
  expect(await fill('Zeta Show').evaluate(el => el.style.width)).toBe('0%')
  await expect(page.locator('a.m-tile', { hasText: 'Epsilon Show' })).toBeVisible()
  await expect(page.locator('a.m-tile', { hasText: 'Epsilon Show' }).locator('.m-tilebar')).toHaveCount(0)
  await page.getByRole('button', { name: 'List' }).click()
  await expect(page.getByText('4 of 5 episodes')).toBeVisible()
  await expect(page.getByText('0 of 9 episodes')).toBeVisible()
  await expect(page.getByText('Nothing wanted')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Search Missing' })).toHaveCount(2)
  await page.getByRole('button', { name: 'Has Missing' }).click()
  await expect(page.locator('.m-row-title')).toHaveText(['Delta Show', 'Zeta Show'])

  await page.evaluate(() => localStorage.setItem('arrview.ui.v1.layout', '"classic"'))
  await page.reload()
  // The Has Missing filter is a shared preference, so it carries over to Classic.
  await page.getByRole('button', { name: 'All', exact: true }).click()
  const card = title => page.locator('.show-card-main', { hasText: title })
  await expect(card('Delta Show')).toContainText('4/5 eps')
  await expect(card('Delta Show').locator('.progress-fill')).toHaveCSS('background-color', OK)
  await expect(card('Zeta Show')).toContainText('0/9 eps')
  await expect(card('Epsilon Show')).toContainText('Nothing wanted')
  await expect(card('Epsilon Show').locator('.progress-fill')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await expect(page.locator('.stat-chip', { hasText: 'Missing Episodes' })).toContainText('10')
})
