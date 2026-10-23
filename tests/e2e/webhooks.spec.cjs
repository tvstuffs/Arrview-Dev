const { test, expect } = require('@playwright/test')

// Settings shows the two URLs Sonarr and Radarr post their events to. These tests use those URLs the way the two
// apps do and check that the page that is open refreshes, and that the address behind them is saved and fits.
// The worker answers /api requests itself, which the page's request events would still see, but it also keeps
// the events stream from being replaced mid-test: these tests run without it.
test.use({ serviceWorkers: 'block' })

const BASE = 'https://localhost:18778'
const ADDRESS = 'http://192.0.2.10:7777'
const heading = page => page.locator('main h1')
const fits = page => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)
const addressField = page => page.getByLabel('ArrView address for Sonarr and Radarr')
// getByLabel alone would also match the Copy button, whose name contains the same words.
const urlField = (page, service) => page.getByRole('textbox', { name: `${service} webhook URL`, exact: true })
const nav = (page, name) => page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name })
const isEvents = response => new URL(response.url()).pathname === '/api/events'
// Every GET the page makes to one API path.
function watch(page, pathname) {
  const seen = []
  page.on('request', request => { if (request.method() === 'GET' && new URL(request.url()).pathname === pathname) seen.push(request.url()) })
  return seen
}

test('a webhook posted to a URL shown in Settings refreshes the page that is open, and a test message does nothing', async ({ page, request }) => {
  // The app opens its events stream as it loads, so wait for that before anything is posted.
  const connected = page.waitForResponse(isEvents)
  await page.goto('/#/settings')
  await expect(page.getByRole('heading', { name: 'Webhooks' })).toBeVisible()
  await connected
  const sonarr = await urlField(page, 'Sonarr').inputValue()
  const radarr = await urlField(page, 'Radarr').inputValue()
  expect([sonarr, radarr]).toEqual([`${BASE}/api/webhooks/sonarr`, `${BASE}/api/webhooks/radarr`])

  // Sonarr: the Shows page lists the library and refreshes on its events.
  const series = watch(page, '/api/sonarr/series')
  await nav(page, 'Shows').click()
  await expect(heading(page)).toHaveText('TV Shows')
  await expect.poll(() => series.length).toBeGreaterThan(0)
  await page.waitForTimeout(500)

  let before = series.length
  // What the Test button in Sonarr sends is answered and ignored.
  expect((await request.post(sonarr, { data: { eventType: 'Test', series: { id: 1, title: 'Test' }, episodes: [{ id: 1 }] } })).status()).toBe(200)
  await page.waitForTimeout(800)
  expect(series.length).toBe(before)
  // A real event refreshes it.
  const sent = await request.post(sonarr, { data: { eventType: 'Download', series: { id: 1, title: 'Fixture Show' }, episodes: [{ id: 11 }] } })
  expect(sent.status()).toBe(200)
  await expect.poll(() => series.length).toBeGreaterThan(before)

  // Radarr: the Movies page.
  const movies = watch(page, '/api/radarr/movies')
  await nav(page, 'Movies').click()
  await expect(heading(page)).toHaveText('Movies')
  await expect.poll(() => movies.length).toBeGreaterThan(0)
  await page.waitForTimeout(500)
  before = movies.length
  expect((await request.post(radarr, { data: { eventType: 'Test', movie: { id: 2, title: 'Test' } } })).status()).toBe(200)
  await page.waitForTimeout(800)
  expect(movies.length).toBe(before)
  expect((await request.post(radarr, { data: { eventType: 'Download', movie: { id: 2, title: 'Fixture Movie' } } })).status()).toBe(200)
  await expect.poll(() => movies.length).toBeGreaterThan(before)
})

// "Last event received" refreshes every five seconds while Settings is in view, so the first wait is longer than
// the default. Later waits bring the page back into view instead, which refreshes it at once.
const SLOW = { timeout: 15000 }
const line = (page, name) => page.locator('.webhook-activity li', { hasText: new RegExp(`^${name}:`) })
const comesBackIntoView = page => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))

test('Settings lists what Sonarr and Radarr last delivered, and keeps a Test message apart from the event', async ({ page, request }) => {
  // The server's record outlives a test, so every step posts an event type that the step before it did not, and
  // waits for text that only that post can have produced.
  await page.goto('/#/settings')
  await expect(page.getByRole('list', { name: 'Last event received' })).toBeVisible()
  await expect(page.locator('.webhook-activity li')).toHaveCount(2)
  const sonarr = await urlField(page, 'Sonarr').inputValue()
  const radarr = await urlField(page, 'Radarr').inputValue()
  const post = async (url, data) => expect((await request.post(url, { data })).status()).toBe(200)

  // An event is found by the page's own polling.
  await post(sonarr, { eventType: 'Grab', series: { id: 1, title: 'Fixture Show' }, episodes: [{ id: 11 }] })
  await expect(line(page, 'Sonarr')).toContainText('Grab, less than a minute ago.', SLOW)

  // What the Test button in Sonarr sends is listed next to it, and does not replace it.
  await post(sonarr, { eventType: 'Test', series: { id: 1, title: 'Test' }, episodes: [{ id: 1 }] })
  await comesBackIntoView(page)
  await expect(line(page, 'Sonarr')).toContainText('Test message received less than a minute ago.')
  await expect(line(page, 'Sonarr')).toContainText('Grab, less than a minute ago.')

  // A later event replaces the event and leaves the Test message in place.
  await post(sonarr, { eventType: 'SeriesAdd', series: { id: 3, title: 'Another Show' } })
  await comesBackIntoView(page)
  await expect(line(page, 'Sonarr')).toContainText('Series add, less than a minute ago.')
  await expect(line(page, 'Sonarr')).not.toContainText('Grab')
  await expect(line(page, 'Sonarr')).toContainText('Test message received less than a minute ago.')

  // Radarr has its own line, and Sonarr's did not move.
  await post(radarr, { eventType: 'MovieDelete', movie: { id: 2, title: 'Fixture Movie' } })
  await comesBackIntoView(page)
  await expect(line(page, 'Radarr')).toContainText('Movie delete, less than a minute ago.')
  await expect(line(page, 'Sonarr')).not.toContainText('Movie delete')

  // Webhook calls are not authenticated: an event type that is not plain letters is answered and never shown.
  await post(sonarr, { eventType: '<b>x</b>' })
  await post(sonarr, { eventType: 'Rename', series: { id: 1, title: 'Fixture Show' } })
  await comesBackIntoView(page)
  await expect(line(page, 'Sonarr')).toContainText('Rename, less than a minute ago.')
  await expect(line(page, 'Sonarr')).not.toContainText('<b>')
  await expect(line(page, 'Sonarr').locator('b')).toHaveCount(0)
})

// That Settings then stops asking is proved with fake timers in tests/web/webhook-activity.test.jsx.
test('on a server that does not have the route, Settings says so and the rest of the card still works', async ({ page }) => {
  await page.route('**/api/webhooks/last', route => route.fulfill({ status: 404, json: { error: 'Not found' } }))
  await page.goto('/#/settings')
  await expect(page.getByText('This version of ArrView does not report received events.')).toBeVisible()
  await expect(page.locator('.webhook-activity')).toHaveCount(0)
  await expect(urlField(page, 'Sonarr')).toHaveValue(`${BASE}/api/webhooks/sonarr`)
  await expect(page.getByRole('button', { name: 'Copy Sonarr webhook URL' })).toBeEnabled()
})

test('an address typed in Settings changes the URLs, is saved with Save and is there for the next visitor; clearing it goes back to this page', async ({ page, request, browser }) => {
  try {
    await page.goto('/#/settings')
    await expect(addressField(page)).toHaveValue('')
    await addressField(page).fill('192.0.2.10:7777')
    await expect(urlField(page, 'Sonarr')).toHaveValue(`${ADDRESS}/api/webhooks/sonarr`)
    await expect(urlField(page, 'Radarr')).toHaveValue(`${ADDRESS}/api/webhooks/radarr`)
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(heading(page)).toHaveText('Downloads')

    // A browser that has never seen this one reads it from the server.
    const context = await browser.newContext({ ignoreHTTPSErrors: true, serviceWorkers: 'block' })
    const other = await context.newPage()
    await other.goto(`${BASE}/#/settings`)
    await expect(addressField(other)).toHaveValue(ADDRESS)
    await expect(urlField(other, 'Radarr')).toHaveValue(`${ADDRESS}/api/webhooks/radarr`)

    await addressField(other).fill('')
    await other.getByRole('button', { name: 'Save' }).click()
    await expect(heading(other)).toHaveText('Downloads')
    await other.getByRole('link', { name: 'Settings', exact: true }).click()
    await expect(addressField(other)).toHaveValue('')
    await expect(urlField(other, 'Sonarr')).toHaveValue(`${BASE}/api/webhooks/sonarr`)
    await context.close()
  } finally {
    // Leave the fixture's settings as they were, whatever happened above.
    const config = await (await request.get('/api/config')).json()
    await request.post('/api/config', { data: { ...config, webhooks: { baseUrl: '' } } })
  }
})

test('an address that is not one is flagged as it is typed and blocks Save', async ({ page, request }) => {
  await page.goto('/#/settings')
  await addressField(page).fill('http://bad host')
  await expect(page.getByText(/That is not an address yet/)).toBeVisible()
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText(/must look like http:\/\/host:7777/)).toBeVisible()
  await expect(heading(page)).toHaveText('Settings')
  expect((await (await request.get('/api/config')).json()).webhooks).toBeUndefined()
})

for (const width of [305, 320, 390, 834, 1280]) {
  test(`the Webhooks card fits ${width}px with a long address, the longest list lines and every guide open, and Copy is a touch-sized button`, async ({ browser, request }) => {
    // Both lines at their longest: an event and a Test message for each service.
    for (const [service, event] of [['sonarr', { series: { id: 1, title: 'Fixture Show' } }], ['radarr', { movie: { id: 2, title: 'Fixture Movie' } }]]) {
      for (const eventType of ['Download', 'Test']) expect((await request.post(`${BASE}/api/webhooks/${service}`, { data: { eventType, ...event } })).status()).toBe(200)
    }
    const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: width < 834, ignoreHTTPSErrors: true, serviceWorkers: 'block', colorScheme: 'dark' })
    const page = await context.newPage()
    await page.goto(`${BASE}/#/settings`)
    await expect(page.getByRole('heading', { name: 'Webhooks' })).toBeVisible()
    await expect(line(page, 'Sonarr')).toContainText('Download (file import), less than a minute ago. Test message received less than a minute ago.')
    await expect(line(page, 'Radarr')).toContainText('Download (file import), less than a minute ago. Test message received less than a minute ago.')
    await addressField(page).fill('http://a-very-long-host-name-for-the-machine-that-runs-arrview.example.invalid:7777')
    await page.locator('.webhook-card details').evaluateAll(guides => guides.forEach(guide => { guide.open = true }))
    expect(await fits(page)).toBe(true)
    const copy = await page.getByRole('button', { name: 'Copy Sonarr webhook URL' }).boundingBox()
    expect(copy.x).toBeGreaterThanOrEqual(0)
    expect(copy.x + copy.width).toBeLessThanOrEqual(width)
    if (width < 834) expect(copy.height).toBeGreaterThanOrEqual(44)
    for (const summary of await page.locator('.webhook-card summary').all()) {
      const box = await summary.boundingBox()
      if (width < 834) expect(box.height).toBeGreaterThanOrEqual(44)
    }
    await context.close()
  })
}
