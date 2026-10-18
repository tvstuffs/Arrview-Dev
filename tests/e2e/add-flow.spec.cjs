const { test, expect } = require('@playwright/test')
const { seedClassic } = require('./classic.cjs')

test.use({ serviceWorkers: 'block' })

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
  await expect(page.getByRole('dialog')).toBeVisible()
}

for (const layout of ['modern', 'classic']) {
  for (const kind of ['show', 'movie']) {
    for (const [name, viewport] of [['desktop', { width: 1280, height: 800 }], ['402 px', { width: 402, height: 800 }]]) {
      test(`the search field has focus as soon as the Add ${kind} sheet opens (${layout}, ${name}) (criterion 22)`, async ({ page }) => {
        await page.setViewportSize(viewport)
        await openAdd(page, layout, kind)
        // No .focus() call anywhere: this is what a keyboard or screen-reader user gets.
        await expect(page.getByRole('dialog').getByRole('textbox')).toBeFocused()
      })
    }
  }
}
