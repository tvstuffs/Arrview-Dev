const { test, expect } = require('@playwright/test')
const { seedClassic } = require('./classic.cjs')

test.use({ serviceWorkers: 'block' })

const LIVE = 'rgb(63, 208, 243)'
const TEXT = 'rgb(245, 245, 247)'
const FIRST_RESULT = 'Select A long fixture lookup result with descriptive text'
const LAYOUTS = ['modern', 'classic']
const KINDS = ['show', 'movie']
const dialogOf = page => page.getByRole('dialog')
const quality = page => dialogOf(page).getByRole('button', { name: /Quality Profile/ })
const folder = page => dialogOf(page).getByRole('button', { name: /Root Folder/ })
const addButton = (page, kind) => dialogOf(page).getByRole('button', { name: kind === 'show' ? 'Add Show' : 'Add Movie', exact: true })

// Open the Add sheet from the real page controls. Modern has an "Add Show" header button, Classic a "+ Add Show" one.
async function openAdd(page, layout, kind) {
  if (layout === 'classic') await seedClassic(page.context())
  await page.goto(`/#/${kind === 'show' ? 'shows' : 'movies'}`)
  if (layout === 'classic') {
    await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: kind === 'show' ? 'Shows' : 'Movies', exact: true }).click()
    await page.getByRole('button', { name: kind === 'show' ? '+ Add Show' : '+ Add Movie', exact: true }).click()
  } else {
    await expect(page.locator('main h1')).toBeVisible()
    await page.getByRole('button', { name: kind === 'show' ? 'Add Show' : 'Add Movie', exact: true }).click()
  }
  await expect(dialogOf(page)).toBeVisible()
}
async function searchAndSelect(page) {
  await dialogOf(page).getByRole('textbox').fill('fixture')
  await expect(dialogOf(page).getByRole('button', { name: FIRST_RESULT })).toHaveAttribute('aria-pressed', 'true')
  await expect(quality(page)).toContainText('Default')
}
const noOverflow = page => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)

for (const layout of LAYOUTS) {
  for (const kind of KINDS) {
    for (const [name, viewport] of [['desktop', { width: 1280, height: 800 }], ['402 px', { width: 402, height: 800 }]]) {
      test(`the search field has focus as soon as the Add ${kind} sheet opens (${layout}, ${name}) (criterion 22)`, async ({ page }) => {
        await page.setViewportSize(viewport)
        await openAdd(page, layout, kind)
        // No .focus() call anywhere: this is what a keyboard or screen-reader user gets.
        await expect(dialogOf(page).getByRole('textbox')).toBeFocused()
      })
    }

    test(`desktop ${layout} ${kind}: the default profile is selected and tagged, the helper counts it, the folder shows free space (criterion 15)`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 })
      await openAdd(page, layout, kind)
      await searchAndSelect(page)
      const dialog = dialogOf(page)
      await expect(dialog.getByRole('button', { name: /Select / })).toHaveCount(3)
      await expect(dialog.getByText('Already in library')).toBeVisible()
      await expect(dialog.locator('.selected-title')).toHaveText('A long fixture lookup result with descriptive text')
      await expect(dialog.locator('.selected-meta')).toContainText('Drama, Mystery, Thriller')
      await expect(dialog.locator('.selected-meta')).not.toContainText('Comedy')
      // The fixture library uses the second listed profile and folder, so neither is the first one.
      await expect(quality(page)).toContainText('Fixture Standard')
      await expect(quality(page)).toContainText('HD · 720p–1080p')
      await expect(quality(page)).toContainText('Default')
      await expect(dialog.getByText(`Used by 1 of your 1 ${kind}`, { exact: true })).toBeVisible()
      await expect(folder(page)).toContainText('/media/tv2')
      await expect(folder(page)).toContainText('2.1 TB free')
      await expect(dialog.getByRole('switch')).toHaveCount(2)
      await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeVisible()
      await expect(addButton(page, kind)).toBeEnabled()
      await expect(dialog.locator('.add-grabber')).toBeHidden()
      await quality(page).click()
      const options = dialog.getByRole('listbox', { name: 'Quality Profile' }).getByRole('option')
      await expect(options).toHaveCount(3)
      await expect(options.nth(0)).toContainText('HD · 1080p')
      await expect(options.nth(2)).toContainText('SD to 4K')
      await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true')
    })

    test(`${layout} ${kind}: Escape inside the open list closes only the list (criterion 14)`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 })
      await openAdd(page, layout, kind)
      await searchAndSelect(page)
      await quality(page).focus()
      await page.keyboard.press('ArrowDown')
      const listbox = dialogOf(page).getByRole('listbox', { name: 'Quality Profile' })
      await expect(listbox).toBeFocused()
      await page.keyboard.press('End')
      await page.keyboard.press('Escape')
      await expect(listbox).toHaveCount(0)
      await expect(dialogOf(page)).toBeVisible()
      await expect(quality(page)).toBeFocused()
      await expect(quality(page)).toContainText('Fixture Standard') // selection unchanged
      // A second Escape, with no list open, closes the sheet as before.
      await page.keyboard.press('Escape')
      await expect(dialogOf(page)).toHaveCount(0)
    })
  }

  test(`${layout}: every control shows a visible focus indicator (criterion 18)`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await openAdd(page, layout, 'show')
    const info = () => page.evaluate(() => {
      const el = document.activeElement, s = getComputedStyle(el)
      return { tag: el.tagName, type: el.type || null, role: el.getAttribute('role'), popup: el.getAttribute('aria-haspopup'), style: s.outlineStyle, width: s.outlineWidth, color: s.outlineColor, border: s.borderTopColor }
    })
    await expect(dialogOf(page).getByRole('textbox')).toBeFocused()
    const search = await info()
    if (layout === 'modern') expect(search).toMatchObject({ style: 'solid', width: '2px', color: TEXT })
    else { expect(search.style).toBe('none'); await expect.poll(async () => (await info()).border).toBe(LIVE) }
    await dialogOf(page).getByRole('textbox').fill('fixture')
    await expect(dialogOf(page).getByRole('button', { name: FIRST_RESULT })).toHaveAttribute('aria-pressed', 'true')
    await expect(quality(page)).toContainText('Default')
    const walked = []
    for (let i = 0; i < 8; i++) { await page.keyboard.press('Tab'); walked.push(await info()) }
    expect(walked.filter(w => w.popup === 'listbox')).toHaveLength(2)
    expect(walked.filter(w => w.role === 'switch')).toHaveLength(2)
    expect(walked.filter(w => w.tag === 'BUTTON' && !w.popup).length).toBeGreaterThanOrEqual(4) // two results, Cancel, Add
    for (const w of walked) expect(w).toMatchObject({ style: 'solid', width: '2px', color: layout === 'modern' ? TEXT : LIVE })
    // The open listbox, focused, is outlined as well.
    await quality(page).focus()
    await page.keyboard.press('ArrowDown')
    await expect(dialogOf(page).getByRole('listbox')).toBeFocused()
    expect(await info()).toMatchObject({ role: 'listbox', style: 'solid', width: '2px', color: layout === 'modern' ? TEXT : LIVE })
  })

  test(`${layout}: picked profile and folder are the ones posted by Add Show`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await openAdd(page, layout, 'show')
    await searchAndSelect(page)
    await quality(page).click()
    await dialogOf(page).getByRole('option', { name: /Fixture HD 1080p/ }).click()
    await expect(quality(page)).toContainText('Fixture HD 1080p')
    await expect(quality(page)).not.toContainText('Default')
    await expect(dialogOf(page).getByText('Used by 0 of your 1 show', { exact: true })).toBeVisible()
    await folder(page).click()
    await dialogOf(page).getByRole('option', { name: /\/media\/tv\b(?!2)/ }).click()
    await expect(folder(page)).toContainText('850 GB free')
    const posted = page.waitForRequest(r => r.method() === 'POST' && r.url().endsWith('/api/sonarr/series'))
    await addButton(page, 'show').click()
    const body = (await posted).postDataJSON()
    expect(body).toMatchObject({ qualityProfileId: 1, rootFolderPath: '/media/tv', monitored: true, seasonFolder: true, addOptions: { searchForMissingEpisodes: true, monitor: 'all' } })
    expect('id' in body).toBe(false)
    await expect(dialogOf(page)).toHaveCount(0)
  })

  for (const [name, viewport] of [['402 px', { width: 402, height: 800 }], ['320 x 568', { width: 320, height: 568 }]]) {
    test(`${layout} on a phone (${name}): bottom sheet, grabber, footer stays on screen with the quality list open (criteria 16, 17)`, async ({ browser }) => {
      const context = await browser.newContext({ viewport, hasTouch: true, isMobile: true, ignoreHTTPSErrors: true, serviceWorkers: 'block' })
      if (layout === 'classic') await seedClassic(context)
      const page = await context.newPage()
      await page.goto('/#/shows')
      if (layout === 'classic') {
        await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Shows', exact: true }).click()
        await page.getByRole('button', { name: '+ Add Show', exact: true }).click()
      } else {
        await expect(page.locator('main h1')).toBeVisible()
        await page.getByRole('button', { name: 'Add Show', exact: true }).click()
      }
      await expect(dialogOf(page)).toBeVisible()
      await expect(dialogOf(page).getByRole('textbox')).toBeFocused()
      await searchAndSelect(page)
      const sheet = await dialogOf(page).boundingBox()
      expect(sheet.x).toBeLessThanOrEqual(1)
      expect(sheet.width).toBeGreaterThanOrEqual(viewport.width - 1)
      expect(sheet.y + sheet.height).toBeGreaterThanOrEqual(viewport.height - 1)
      const grabber = dialogOf(page).locator('.add-grabber')
      await expect(grabber).toBeVisible()
      await expect(grabber).toHaveAttribute('aria-hidden', 'true')
      const bar = await grabber.boundingBox()
      expect(Math.abs(bar.width - 40)).toBeLessThanOrEqual(1)
      expect(Math.abs(bar.height - 5)).toBeLessThanOrEqual(1)
      expect(bar.y - sheet.y).toBeLessThan(110)
      await quality(page).click()
      await expect(dialogOf(page).getByRole('listbox', { name: 'Quality Profile' })).toBeVisible()
      await expect(dialogOf(page).getByRole('button', { name: 'Cancel' })).toBeInViewport()
      await expect(addButton(page, 'show')).toBeInViewport()
      // The content scrolls; the footer does not move.
      const footer = dialogOf(page).locator('.add-footer')
      const before = await footer.boundingBox()
      await page.locator('.sheet-content').evaluate(el => { el.scrollTop = el.scrollHeight })
      expect(await footer.boundingBox()).toEqual(before)
      await expect(addButton(page, 'show')).toBeInViewport()
      for (const button of [dialogOf(page).getByRole('button', { name: 'Cancel' }), addButton(page, 'show')]) expect((await button.boundingBox()).height).toBeGreaterThanOrEqual(43.9)
      expect(await noOverflow(page)).toBe(true)
      // The result row scrolls inside the sheet instead of widening the page.
      if (viewport.width <= 360) expect(await dialogOf(page).locator('.modal-results').evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true)
      await context.close()
    })
  }
}
