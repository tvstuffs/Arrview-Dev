const { test, expect, request: apiRequest } = require('@playwright/test')
const { seedClassic } = require('./classic.cjs')

// The fixture starts with the login off. This spec turns it on through the UI, and always turns it off again, so the
// other spec files run as before. At most one wrong password per layout: the limiter allows ten failures.
test.use({ serviceWorkers: 'block' })

const HTTPS = 'https://localhost:18778'
const HTTP = 'http://localhost:18779'
const PASSWORD = 'e2e test password 1'
const nav = page => page.getByRole('navigation', { name: 'Main navigation' })
const card = page => page.locator('section[aria-label="Security"]')

async function ensureOff() {
  const api = await apiRequest.newContext({ baseURL: HTTPS, ignoreHTTPSErrors: true })
  try {
    const status = await (await api.get('/api/auth/status')).json()
    if (!status.required) return
    const login = await api.post('/api/auth/login', { data: { password: PASSWORD } })
    if (login.ok()) await api.post('/api/auth/password/remove', { data: { currentPassword: PASSWORD }, headers: { 'X-Requested-With': 'ArrView' } })
  } finally { await api.dispose() }
}

async function openSettings(page, layout) {
  if (layout === 'modern') { await page.goto('/#/settings'); return }
  await page.goto('/')
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
}
const openTab = (page, layout, name) => (layout === 'modern'
  ? nav(page).getByRole('link', { name, exact: true }).click()
  : nav(page).getByRole('button', { name, exact: true }).click())
const signInHeading = page => page.getByRole('heading', { name: 'Sign in' })
async function signIn(page, password = PASSWORD) {
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign In' }).click()
}
// The app's own preferences, without the open-tab key (which the app rewrites every time a tab is clicked).
const prefs = page => page.evaluate(() => Object.fromEntries(Object.entries(localStorage).filter(([k]) => k.startsWith('arrview') && !k.endsWith('.tab'))))
async function freshContext(browser, layout, options = {}) {
  const context = await browser.newContext({ ignoreHTTPSErrors: true, ...options })
  if (layout === 'classic') await seedClassic(context)
  // a preference of our own, to prove that signing in and out never touches local storage
  await context.addInitScript(() => { if (!localStorage.getItem('arrview.e2e.pref')) localStorage.setItem('arrview.e2e.pref', 'kept') })
  return context
}

// The first-run screen needs a data folder with neither config.json nor auth.json, which the shared fixture never has, so
// the status answer is replaced here (the server side of the choice is covered by the node tests). It sits above both layouts.
for (const layout of ['modern', 'classic']) {
  test.describe(`first-run screen, ${layout} layout`, () => {
    test.beforeAll(ensureOff)
    for (const choice of ['skip', 'password']) {
      test(`${choice === 'skip' ? 'continue without a password' : 'protect with a password'} leaves the screen`, async ({ browser }) => {
        const context = await freshContext(browser, layout)
        const page = await context.newPage()
        let pending = true
        const posted = []
        await page.route('**/api/auth/status', route => route.fulfill({ json: { required: false, signedIn: false, source: 'none', authDisabledByDocker: false, setupPending: pending, passwordMinLength: 8, passwordMaxLength: 256 } }))
        await page.route('**/api/auth/setup/skip', route => { posted.push('skip'); pending = false; route.fulfill({ json: { success: true } }) })
        await page.route('**/api/auth/password', route => { posted.push(route.request().postDataJSON()); pending = false; route.fulfill({ json: { success: true } }) })
        await page.goto('/')
        await expect(page.getByRole('heading', { name: 'Protect ArrView?' })).toBeVisible()
        await expect(page.getByText('including deleting files', { exact: false })).toBeVisible()
        await expect(nav(page)).toHaveCount(0)
        if (choice === 'skip') {
          await page.getByRole('button', { name: 'Continue without a password' }).click()
          expect(posted).toEqual(['skip'])
        } else {
          await page.getByRole('button', { name: 'Protect with a password' }).click()
          await page.getByLabel('New password', { exact: true }).fill(PASSWORD)
          await page.getByLabel('Confirm new password').fill(PASSWORD)
          await page.getByRole('button', { name: 'Save password' }).click()
          expect(posted).toEqual([{ newPassword: PASSWORD }])
        }
        await expect(page.getByRole('heading', { name: 'Protect ArrView?' })).toHaveCount(0)
        await expect(nav(page)).toBeVisible()
        await context.close()
      })
    }
  })
}

for (const layout of ['modern', 'classic']) {
  test.describe(`${layout} layout`, () => {
    test.describe.configure({ mode: 'serial' })
    test.afterAll(ensureOff)

    test('Settings turns the login on, and this browser stays signed in across a reload', async ({ browser }) => {
      const context = await freshContext(browser, layout)
      const page = await context.newPage()
      await openSettings(page, layout)
      await expect(card(page).getByText('No password is set.', { exact: false })).toBeVisible()
      await card(page).getByRole('button', { name: 'Set a password' }).click()
      await page.getByLabel('New password', { exact: true }).fill(PASSWORD)
      await page.getByLabel('Confirm new password').fill(PASSWORD)
      await card(page).getByRole('button', { name: 'Save password' }).click()
      await expect(card(page).getByText('Password protection is on.', { exact: false })).toBeVisible()
      await page.reload()
      await expect(signInHeading(page)).toHaveCount(0)
      await expect(nav(page)).toBeVisible()
      await context.close()
    })

    test('a fresh browser sees Sign in first, asks for nothing else, and gets live events after signing in', async ({ browser, request }) => {
      const context = await freshContext(browser, layout)
      const page = await context.newPage()
      const requests = []
      page.on('request', r => { const p = new URL(r.url()).pathname; if (p.startsWith('/api/')) requests.push(p) })
      await page.goto('/')
      await expect(signInHeading(page)).toBeVisible()
      await page.waitForTimeout(500)
      expect(requests.filter(p => p !== '/api/auth/status')).toEqual([])
      await signIn(page, 'not the password')
      await expect(page.getByRole('alert')).toHaveText('Incorrect password')
      await signIn(page)
      await expect(nav(page)).toBeVisible()
      await page.reload()
      await expect(nav(page)).toBeVisible()
      await expect(signInHeading(page)).toHaveCount(0)

      const series = []
      page.on('request', r => { if (r.method() === 'GET' && new URL(r.url()).pathname === '/api/sonarr/series') series.push(r.url()) })
      await openTab(page, layout, 'Shows')
      await expect.poll(() => series.length).toBeGreaterThan(0)
      await page.waitForTimeout(1000)
      const before = series.length
      const sent = await request.post(`${HTTPS}/api/webhooks/sonarr`, { data: { eventType: 'Download', series: { id: 1, title: 'Fixture Show' }, episodes: [{ id: 11 }] } })
      expect(sent.status()).toBe(200)
      await expect.poll(() => series.length, { timeout: 15000 }).toBeGreaterThan(before)
      await context.close()
    })

    test('Sign out shows Sign in, signing in again works, and the layout preference is untouched', async ({ browser }) => {
      const context = await freshContext(browser, layout)
      const page = await context.newPage()
      await page.goto('/')
      await signIn(page)
      await expect(nav(page)).toBeVisible()
      await openSettings(page, layout)
      const before = await prefs(page)
      expect(before['arrview.e2e.pref']).toBe('kept')
      await card(page).getByRole('button', { name: 'Sign out', exact: true }).click()
      await expect(signInHeading(page)).toBeVisible()
      // the app may write its own state (the open tab); signing in and out must never change or remove what was there
      expect(await prefs(page)).toMatchObject(before)
      await signIn(page)
      await expect(nav(page)).toBeVisible()
      expect(await prefs(page)).toMatchObject(before)
      await context.close()
    })

    test('a key for a script is shown once in a read-only field, copies, is listed by name, and stops working when removed', async ({ browser }) => {
      const context = await freshContext(browser, layout)
      await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: HTTPS })
      const page = await context.newPage()
      await page.goto('/')
      await signIn(page)
      await openSettings(page, layout)
      await card(page).getByLabel('Key name (optional)').fill('E2E script')
      await card(page).getByRole('button', { name: 'Make a key' }).click()
      const field = card(page).getByLabel('New key for E2E script')
      await expect(field).toHaveAttribute('readonly', '')
      const key = await field.inputValue()
      expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/)
      const api = await apiRequest.newContext({ baseURL: HTTPS, ignoreHTTPSErrors: true, extraHTTPHeaders: { 'X-Api-Key': key } })
      expect((await api.get('/api/config')).ok()).toBe(true)
      await card(page).getByRole('button', { name: 'Copy' }).click()
      await expect(card(page).getByText('Copied', { exact: true })).toBeVisible()
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(key)
      await card(page).getByRole('button', { name: 'Done' }).click()
      await expect(card(page).getByText('E2E script', { exact: true })).toBeVisible()
      await page.reload()
      await expect(card(page).getByText('E2E script', { exact: true })).toBeVisible()
      expect(await page.content()).not.toContain(key)
      await card(page).getByRole('button', { name: 'Remove key E2E script' }).click()
      await page.getByRole('button', { name: 'Remove key', exact: true }).click()
      await expect(card(page).getByText('E2E script', { exact: true })).toHaveCount(0)
      expect((await api.get('/api/config')).status()).toBe(401)
      await api.dispose()
      await context.close()
    })

    test('a 401 mid-session returns to Sign in with a notice, keeps local preferences, and comes back to the same place', async ({ browser }) => {
      const context = await freshContext(browser, layout)
      const page = await context.newPage()
      await page.goto('/')
      await signIn(page)
      await openTab(page, layout, 'Shows')
      await expect(nav(page)).toBeVisible()
      const before = await prefs(page)
      const other = await apiRequest.newContext({ baseURL: HTTPS, ignoreHTTPSErrors: true })
      expect((await other.post('/api/auth/login', { data: { password: PASSWORD } })).ok()).toBe(true)
      expect((await other.post('/api/auth/logout-all', { data: {}, headers: { 'X-Requested-With': 'ArrView' } })).ok()).toBe(true)
      await other.dispose()
      await openTab(page, layout, 'Movies')
      await expect(signInHeading(page)).toBeVisible()
      await expect(page.getByText('Your session ended. Sign in again.')).toBeVisible()
      expect(await prefs(page)).toMatchObject(before)
      const where = new URL(page.url()).hash
      await signIn(page)
      await expect(nav(page)).toBeVisible()
      expect(await prefs(page)).toMatchObject(before)
      expect(new URL(page.url()).hash).toBe(where)
      if (layout === 'modern') expect(where).toMatch(/movies/)
      await context.close()
    })

    test('over the plain http listener the cookie works without Secure, and survives a reload', async ({ browser }) => {
      const context = await freshContext(browser, layout, { baseURL: HTTP })
      const page = await context.newPage()
      await page.goto('/')
      await signIn(page)
      await expect(nav(page)).toBeVisible()
      const cookie = (await context.cookies()).find(c => c.name === 'arrview_session')
      expect(cookie).toBeTruthy()
      expect(cookie.secure).toBe(false)
      expect(cookie.httpOnly).toBe(true)
      await page.reload()
      await expect(nav(page)).toBeVisible()
      await expect(signInHeading(page)).toHaveCount(0)
      await context.close()
    })
  })
}

test.describe('service worker', () => {
  test.use({ serviceWorkers: 'allow' })
  test.afterAll(ensureOff)

  test('a 401 episode leaves nothing under /api in any cache', async ({ browser, request }) => {
    expect((await request.post(`${HTTPS}/api/auth/password`, { data: { newPassword: PASSWORD } })).ok()).toBe(true)
    const context = await browser.newContext({ ignoreHTTPSErrors: true, storageState: await request.storageState() })
    const page = await context.newPage()
    await page.goto('/#/shows')
    await expect(nav(page)).toBeVisible()
    await page.evaluate(() => navigator.serviceWorker.ready)
    await page.reload()
    await expect(nav(page)).toBeVisible()
    const all = await request.post(`${HTTPS}/api/auth/logout-all`, { data: {}, headers: { 'X-Requested-With': 'ArrView' } })
    expect([all.status(), await all.text()]).toEqual([200, '{"success":true}'])
    await nav(page).getByRole('link', { name: 'Movies', exact: true }).click()
    await expect(signInHeading(page)).toBeVisible()
    const cached = await page.evaluate(async () => {
      const out = []
      for (const name of await caches.keys()) {
        const cache = await caches.open(name)
        for (const entry of await cache.keys()) out.push(new URL(entry.url).pathname)
      }
      return out
    })
    expect(cached.filter(p => p.startsWith('/api/'))).toEqual([])
    await context.close()
  })
})
