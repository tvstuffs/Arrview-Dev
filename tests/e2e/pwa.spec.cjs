const { test, expect } = require('@playwright/test')
const sharp = require('sharp')

async function controlled(page) {
  await page.goto('/')
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
    if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }))
  })
}

test('manifest, icons, mutable headers and backward-compatible identity', async ({ request }) => {
  const response = await request.get('/manifest.webmanifest')
  expect(response.headers()['cache-control']).toBe('no-cache')
  const manifest = await response.json()
  expect(manifest).toMatchObject({ id: '/', name: 'ArrView', short_name: 'ArrView', start_url: '/', scope: '/', display: 'standalone', theme_color: '#0d1117', background_color: '#0d1117' })
  expect(manifest.icons).toHaveLength(3)
  for (const icon of [...manifest.icons, { src: '/apple-touch-icon.png', sizes: '180x180' }]) {
    const image = await request.get(icon.src)
    expect(image.ok()).toBe(true)
    const metadata = await sharp(await image.body()).metadata()
    expect(`${metadata.width}x${metadata.height}`).toBe(icon.sizes)
  }
  expect(manifest.icons.find(icon => icon.purpose === 'maskable').sizes).toBe('512x512')
  expect((await request.get('/sw.js')).headers()['cache-control']).toBe('no-cache')
  const identity = await (await request.get('/api/arrview/identify')).json()
  expect(identity).toMatchObject({ app: 'arrview', version: '1.10', capabilities: ['pwa', 'ping', 'health'], services: { sonarr: true, radarr: true, sabnzbd: true, nzbhydra: true } })
})

test('HTTPS worker controls page, caches only shell and never API reads or writes', async ({ page, context }) => {
  await controlled(page)
  await expect(page.getByText('Bytes history')).toBeVisible()
  await expect(page.getByText('1.0 GB', { exact: true })).toBeVisible()
  await expect(page.getByText('512 MB', { exact: true })).toBeVisible()
  const result = await page.evaluate(async () => {
    const config = await (await fetch('/api/config')).json()
    const saved = await fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) })
    await fetch('/api/health')
    const entries = []
    for (const key of await caches.keys()) for (const request of await (await caches.open(key)).keys()) {
      entries.push({ url: request.url, text: request.url.includes('.png') ? '' : await (await caches.match(request)).text() })
    }
    return { saved: saved.status, entries }
  })
  expect(result.saved).toBe(200)
  expect(result.entries.length).toBeGreaterThan(3)
  for (const entry of result.entries) {
    expect(new URL(entry.url).pathname).not.toMatch(/^\/api(?:\/|$)/)
    expect(entry.text).not.toContain('fixture-only-key')
  }
  await context.setOffline(true)
  const offline = await page.evaluate(async () => {
    const results = []
    for (const url of ['/api/config', '/api/health', '/api/sabnzbd/history']) {
      try { await fetch(url); results.push('unexpected cached response') } catch { results.push('network failure') }
    }
    return results
  })
  expect(offline).toEqual(['network failure', 'network failure', 'network failure'])
})

test('offline navigation shows honest fallback and health-probed retry recovers', async ({ page, context }) => {
  await controlled(page)
  await context.setOffline(true)
  await page.goto('/offline-navigation-fixture')
  await expect(page.getByRole('heading', { name: 'Can’t reach your ArrView server' })).toBeVisible()
  await expect(page.getByText(/Media and downloads aren’t available offline/)).toBeVisible()
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page.getByRole('status')).toHaveText(/Still unable/)
  await context.setOffline(false)
  // The offline page retries its health probe on the online event.
  await expect(page.getByText('Bytes history')).toBeVisible()
})

test('cached navigation does not show stale dashboard while offline', async ({ page, context }) => {
  await controlled(page)
  await page.reload()
  await expect(page.getByText('Bytes history')).toBeVisible()
  await context.setOffline(true)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Can’t reach your ArrView server' })).toBeVisible()
  await expect(page.getByText('Bytes history')).toHaveCount(0)
})

test('settings save keeps active tab and does not reload document', async ({ page }) => {
  await controlled(page)
  await page.getByRole('button', { name: 'Movies', exact: false }).click()
  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.getByRole('heading', { name: 'Add to Home Screen' })).toBeVisible()
  const navigationCount = await page.evaluate(() => performance.getEntriesByType('navigation').length)
  await page.evaluate(() => { window.fixtureDocumentMarker = 'same-document' })
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Movies', exact: false })).toHaveClass(/active/)
  expect(await page.evaluate(() => window.fixtureDocumentMarker)).toBe('same-document')
  expect(await page.evaluate(() => performance.getEntriesByType('navigation').length)).toBe(navigationCount)
})

for (const width of [305, 320, 360, 390, 402, 440, 466, 669, 834, 1280]) {
  test(`W1 install-help and offline layout at ${width}px`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width, height: 890 }, hasTouch: true, ignoreHTTPSErrors: true })
    const page = await context.newPage()
    await page.goto('https://localhost:18778/')
    await page.getByRole('button', { name: 'Settings' }).click()
    // Offer a fixture Chromium prompt to measure the new touch control.
    await page.evaluate(() => {
      const event = new Event('beforeinstallprompt', { cancelable: true })
      event.prompt = () => Promise.resolve()
      event.userChoice = Promise.resolve({ outcome: 'dismissed' })
      window.dispatchEvent(event)
    })
    const help = page.getByRole('region', { name: 'Add to Home Screen' })
    await help.scrollIntoViewIfNeeded()
    const bounds = await help.boundingBox()
    expect(bounds.x).toBeGreaterThanOrEqual(0)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width)
    const install = await page.getByRole('button', { name: 'Install ArrView' }).boundingBox()
    expect(install.height).toBeGreaterThanOrEqual(44)
    expect(install.width).toBeGreaterThanOrEqual(44)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    if (width === 305 || width === 466) await page.screenshot({ path: `test-results/install-${width}.png` })
    await page.goto('https://localhost:18778/offline.html')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    expect((await page.getByRole('button', { name: 'Try again' }).boundingBox()).height).toBeGreaterThanOrEqual(44)
    await context.close()
  })
}

test('insecure HTTP has no worker and explains Android shortcut', async ({ browser }) => {
  const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile' })
  const page = await context.newPage()
  await page.goto('http://arrview.test:18779')
  expect(await page.evaluate(() => window.isSecureContext)).toBe(false)
  expect(await page.evaluate(() => 'serviceWorker' in navigator)).toBe(false)
  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.getByText(/creates a shortcut that opens in Chrome/)).toBeVisible()
  await expect(page.getByText(/Offline startup is unavailable/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Install ArrView' })).toHaveCount(0)
  await context.close()
})


test('new service worker activates and refreshes an open shell automatically', async ({ page }) => {
  await controlled(page)
  await expect(page.getByText('Bytes history')).toBeVisible()
  await page.evaluate(() => { window.fixtureBeforeUpdate = true })
  await page.evaluate(async () => {
    await fetch('/__fixture/update-worker', { method: 'POST' })
    const registration = await navigator.serviceWorker.getRegistration()
    await registration.update()
  })
  await expect.poll(() => page.evaluate(() => window.fixtureBeforeUpdate)).toBeUndefined()
  await expect(page.getByText('Bytes history')).toBeVisible()
})
