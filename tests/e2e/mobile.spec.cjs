const { test, expect } = require('@playwright/test')

async function fit(page, root = 'body') {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  const bad = await page.locator(root).evaluateAll(roots => roots.flatMap(root => [...root.querySelectorAll('button, a[href], input, select, [role="button"]')]).filter(el => {
    const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.width < 43.9 || r.height < 43.9)
  }).map(el => ({ name: el.getAttribute('aria-label') || el.textContent || el.type, width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height })))
  expect(bad).toEqual([])
  if (root !== 'body') {
    const box = await page.locator(root).boundingBox(), viewport = page.viewportSize()
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.y).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1)
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1)
  }
}
async function tab(page, name) { await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name, exact: true }).click() }
async function close(page) { await page.getByRole('button', { name: 'Close dialog' }).click(); await expect(page.getByRole('dialog')).toHaveCount(0) }

for (const width of [305, 320, 360, 390, 402, 440, 466, 669, 834, 1280]) {
  test(`all tabs and sheets fit ${width}px touch viewport`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width, height: 890 }, hasTouch: true, ignoreHTTPSErrors: true, colorScheme: width % 2 ? 'light' : 'dark' })
    const page = await context.newPage()
    await page.goto('https://localhost:18778')
    await expect(page.getByText('Bytes history')).toBeVisible()
    await fit(page)
    const nav = await page.getByRole('navigation').boundingBox()
    if (width < 640) expect(nav.y + nav.height).toBe(890)
    await page.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(page.getByRole('dialog')).toBeVisible(); await fit(page, 'dialog'); await close(page)
    await page.getByRole('button', { name: /Search NZBs/ }).click(); await fit(page, 'dialog'); await close(page)
    await tab(page, 'Shows')
    await page.getByRole('button', { name: 'Episodes for Fixture Show with a long title' }).click()
    await page.getByRole('button', { name: 'Season 1', exact: true }).click()
    await expect(page.getByText('Downloaded episode with a long descriptive title', { exact: true })).toBeVisible()
    await fit(page)
    if (width === 305 || width === 466) await page.screenshot({ path: `test-results/w2-shows-${width}.png`, fullPage: true })
    await page.getByRole('button', { name: 'Interactive search — pick a release manually' }).click()
    await expect(page.getByText('Fixture.Show.S01E02.1080p.Long.Release.Name')).toBeVisible()
    await fit(page, 'dialog'); await close(page)
    await page.getByRole('button', { name: 'Delete and unmonitor Downloaded episode with a long descriptive title' }).click()
    await expect(page.getByRole('button', { name: 'Delete and Unmonitor', exact: true })).toBeVisible()
    await fit(page, 'dialog'); await close(page)
    await page.getByRole('button', { name: 'Remove Fixture Show with a long title from Sonarr' }).click()
    await fit(page, 'dialog'); await close(page)
    await page.getByRole('button', { name: 'Delete downloaded files in Season 1' }).click()
    await fit(page, 'dialog'); await close(page)
    await page.getByRole('button', { name: '+ Add Show', exact: true }).click()
    await page.getByPlaceholder('Search for a tv show…').fill('fixture')
    await page.getByRole('button', { name: 'Select A long fixture lookup result with descriptive text' }).click()
    await fit(page, 'dialog')
    if (width === 305) await page.screenshot({ path: 'test-results/w2-add-305.png' })
    await close(page)
    await tab(page, 'Upcoming'); await expect(page.getByText('S01E02 · Calendar fixture episode')).toBeVisible(); await fit(page)
    await page.getByRole('button', { name: /Fixture Show with a long title S01E02/ }).click()
    await expect(page.getByRole('button', { name: 'Episodes for Fixture Show with a long title' })).toHaveAttribute('aria-expanded', 'true')
    await tab(page, 'Movies'); await expect(page.getByText('Fixture Movie with a long descriptive title')).toBeVisible(); await fit(page)
    await page.getByRole('button', { name: 'Interactive Search', exact: true }).click(); await expect(page.getByText('Fixture.Show.S01E02.1080p.Long.Release.Name')).toBeVisible(); await fit(page, 'dialog'); await close(page)
    await page.getByRole('button', { name: 'Delete Fixture Movie with a long descriptive title' }).click(); await fit(page, 'dialog'); await close(page)
    await page.getByRole('button', { name: 'Posters', exact: true }).click(); await fit(page)
    if (width === 305) await page.screenshot({ path: 'test-results/w3-movies-305.png', fullPage: true })
    await page.getByRole('button', { name: '+ Add Movie', exact: true }).click(); await fit(page, 'dialog'); await close(page)
    await tab(page, 'Search')
    await page.getByPlaceholder('Search for something to download…').fill('fixture')
    await page.getByRole('main').getByRole('button', { name: 'Search', exact: true }).click()
    await expect(page.getByText('A lengthy fixture NZB result title')).toBeVisible(); await fit(page)
    await tab(page, 'Settings'); await expect(page.getByRole('heading', { name: 'Add to Home Screen' })).toBeVisible(); await fit(page)
    await context.close()
  })
}

test('tab, filters, sort and expanded show/season survive reload; cancelling confirmations makes no mutation', async ({ page, request }) => {
  await page.goto('/')
  await tab(page, 'Shows')
  await page.getByLabel('Search shows', { exact: true }).fill('fixture')
  await page.getByRole('button', { name: 'Has Missing', exact: true }).click()
  await page.getByLabel('Sort results').selectOption('year')
  await page.getByRole('button', { name: 'Episodes for Fixture Show with a long title' }).click()
  await page.getByRole('button', { name: 'Season 1', exact: true }).click()
  await page.reload()
  await expect(page.getByRole('button', { name: 'Shows', exact: true })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByLabel('Search shows', { exact: true })).toHaveValue('fixture')
  await expect(page.getByLabel('Sort results')).toHaveValue('year')
  await expect(page.getByText('Downloaded episode with a long descriptive title', { exact: true })).toBeVisible()
  await request.post('/__fixture/reset-requests')
  await page.getByRole('button', { name: 'Delete and unmonitor Downloaded episode with a long descriptive title' }).click()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.getByText('Episode deleted and unmonitored', { exact: true })).toHaveCount(0)
  expect((await (await request.get('/__fixture/requests')).json()).filter(r => r.method !== 'GET')).toEqual([])
})

test('keyboard modal traps focus, Escape closes, and returns focus to its trigger', async ({ page }) => {
  await page.goto('/'); await tab(page, 'Movies')
  const trigger = page.getByRole('button', { name: '+ Add Movie', exact: true })
  await trigger.click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Shift+Tab')
  expect(await page.evaluate(() => document.activeElement.closest('dialog') !== null)).toBe(true)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(trigger).toBeFocused()
})

test('light/dark follow system and narrow large text remains usable', async ({ page }) => {
  await page.setViewportSize({ width: 305, height: 890 })
  await page.emulateMedia({ colorScheme: 'light' }); await page.goto('/')
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(245, 247, 250)')
  await page.emulateMedia({ colorScheme: 'dark' })
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(13, 17, 23)')
  await tab(page, 'Shows')
  await page.addStyleTag({ content: 'button,input,select,p,span,label,h2 {font-size: 20px !important;}' })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
})

test('single SSE and active-tab polling stop hidden and catch up on resume', async ({ page, request }) => {
  await page.addInitScript(() => {
    const Native = window.EventSource
    window.fixtureStreams = { active: 0, maximum: 0 }
    window.EventSource = class extends Native {
      constructor(...args) { super(...args); window.fixtureStreams.active++; window.fixtureStreams.maximum = Math.max(window.fixtureStreams.active, window.fixtureStreams.maximum) }
      close() { window.fixtureStreams.active--; super.close() }
    }
  })
  await page.clock.install()
  await page.goto('/'); await tab(page, 'Movies')
  await expect(page.getByText('Fixture Movie with a long descriptive title')).toBeVisible()
  expect(await page.evaluate(() => window.fixtureStreams)).toEqual({ active: 1, maximum: 1 })
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')) })
  await request.post('/__fixture/reset-requests')
  await page.clock.runFor(120000)
  expect(await page.evaluate(() => window.fixtureStreams.active)).toBe(0)
  expect(await (await request.get('/__fixture/requests')).json()).toEqual([])
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')) })
  await expect.poll(async () => (await (await request.get('/__fixture/requests')).json()).some(r => r.path === '/api/v3/movie')).toBe(true)
  expect(await page.evaluate(() => window.fixtureStreams)).toEqual({ active: 1, maximum: 1 })
  await request.post('/__fixture/reset-requests')
  await page.clock.runFor(60000)
  await expect.poll(async () => (await (await request.get('/__fixture/requests')).json()).some(r => r.path === '/api/v3/movie')).toBe(true)
})

test('short viewport sheet scrolls without losing its close button', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 })
  await page.goto('/'); await tab(page, 'Shows')
  await page.getByRole('button', { name: '+ Add Show', exact: true }).click()
  await page.getByPlaceholder('Search for a tv show…').fill('fixture')
  await page.getByRole('button', { name: 'Select A long fixture lookup result with descriptive text' }).click()
  await page.getByRole('button', { name: 'Add TV Show', exact: true }).scrollIntoViewIfNeeded()
  await expect(page.getByRole('button', { name: 'Close dialog' })).toBeInViewport()
  await expect(page.getByRole('button', { name: 'Add TV Show', exact: true })).toBeInViewport()
  await fit(page, 'dialog')
})

test('removed services cannot leave a restored tab blank', async ({ page }) => {
  // An unconfigured remembered tab must fall back to a currently available one.
  await page.addInitScript(() => localStorage.setItem('arrview.ui.v1.tab', JSON.stringify('movies')))
  await page.route('**/api/config', route => route.fulfill({ json: { sonarr: { url: 'http://example.invalid', apikey: 'fixture' } } }))
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Shows', exact: true })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('button', { name: 'Movies', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Downloads', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Search', exact: true })).toHaveCount(0)
})
