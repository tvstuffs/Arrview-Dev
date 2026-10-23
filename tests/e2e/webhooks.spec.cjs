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
  test(`the Webhooks card fits ${width}px with a long address and every guide open, and Copy is a touch-sized button`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: width < 834, ignoreHTTPSErrors: true, serviceWorkers: 'block', colorScheme: 'dark' })
    const page = await context.newPage()
    await page.goto(`${BASE}/#/settings`)
    await expect(page.getByRole('heading', { name: 'Webhooks' })).toBeVisible()
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
