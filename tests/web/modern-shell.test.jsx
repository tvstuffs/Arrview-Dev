import React from 'react'
import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, fireEvent, waitFor, act } from '@testing-library/react'
import Dashboard from '../../src/components/Dashboard'
import ConfigPage from '../../src/components/ConfigPage'
import { parseHash } from '../../src/hooks/useHashRoute'
import { reply, config, stubFetch, stubMedia, resetEnvironment } from './modern-helpers'

let restoreMedia
beforeEach(() => { resetEnvironment(); restoreMedia = stubMedia({ phone: false }); stubFetch(); window.scrollTo = vi.fn() })
afterEach(() => { restoreMedia(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

const go = hash => { window.location.hash = hash }
const view = (cfg = config) => render(<Dashboard config={cfg} onConfigSaved={() => {}} />)
const nav = () => screen.getByRole('navigation', { name: 'Main navigation' })
const navNames = () => within(nav()).getAllByRole('link').map(a => a.textContent.trim())

test('parseHash accepts the eight routes and rejects everything else', () => {
  expect(parseHash('#/shows/12')).toMatchObject({ section: 'shows', id: '12', path: '/shows/12', valid: true })
  expect(parseHash('#/movies/')).toMatchObject({ section: 'movies', id: null, valid: true })
  for (const bad of ['', '#', '#/', '#/nope', '#/downloads/3', '#/shows/1/2', '#/shows//']) expect(parseHash(bad).valid, bad).toBe(false)
})

test('no stored layout renders Modern: nav links, no Classic tab bar (criterion 1)', async () => {
  go('#/downloads'); const { container } = view()
  await screen.findByRole('heading', { level: 1, name: 'Downloads' })
  expect(navNames()).toEqual(['Downloads', 'Shows', 'Upcoming', 'Movies', 'Search'])
  expect(container.querySelector('.tabbar')).toBeNull()
})
test('stored classic renders the Classic shell and clears a stale hash; invalid values fall back to Modern', async () => {
  localStorage.setItem('arrview.ui.v1.layout', '"classic"'); go('#/shows/1')
  const { container, unmount } = view()
  expect(container.querySelector('.tabbar')).not.toBeNull()
  expect(window.location.hash).toBe('')
  unmount()
  localStorage.setItem('arrview.ui.v1.layout', '"sideways"'); go('#/downloads')
  const second = view()
  expect(second.container.querySelector('.tabbar')).toBeNull()
  expect(second.container.querySelector('.m-shell')).not.toBeNull()
})

test('Settings has a Layout fieldset: Modern checked, choosing Classic switches, persists and stays on Settings (criteria 2, 3)', async () => {
  go('#/settings'); const { container } = view()
  const group = await screen.findByRole('group', { name: 'Layout' })
  expect(within(group).getByRole('radio', { name: 'Modern' })).toBeChecked()
  expect(within(group).getByRole('radio', { name: 'Classic' })).not.toBeChecked()
  fireEvent.click(within(group).getByRole('radio', { name: 'Classic' }))
  expect(localStorage.getItem('arrview.ui.v1.layout')).toBe('"classic"')
  await waitFor(() => expect(container.querySelector('.tabbar')).not.toBeNull())
  const classic = await screen.findByRole('group', { name: 'Layout' })
  expect(within(classic).getByRole('radio', { name: 'Classic' })).toBeChecked()
  fireEvent.click(within(classic).getByRole('radio', { name: 'Modern' }))
  expect(localStorage.getItem('arrview.ui.v1.layout')).toBe('"modern"')
  await screen.findByRole('heading', { level: 1, name: 'Settings' })
  expect(window.location.hash).toBe('#/settings')
})
test('first-run ConfigPage shows no Layout control, and hideHeader drops its own h1', () => {
  const { unmount } = render(<ConfigPage onSave={() => {}} />)
  expect(screen.queryByRole('group', { name: 'Layout' })).toBeNull()
  expect(screen.getByRole('heading', { level: 1, name: 'ArrView' })).toBeInTheDocument()
  unmount()
  render(<ConfigPage onSave={() => {}} onBack={() => {}} hideHeader layout="modern" onLayoutChange={() => {}} />)
  expect(screen.queryByRole('heading', { level: 1 })).toBeNull()
})

test('the section is kept across a switch through the shared tab preference (criterion 3)', async () => {
  go('#/shows/1'); const first = view()
  await screen.findByRole('heading', { level: 1, name: 'Alpha Show' })
  expect(JSON.parse(localStorage.getItem('arrview.ui.v1.tab'))).toBe('shows')
  first.unmount()
  localStorage.setItem('arrview.ui.v1.layout', '"classic"')
  const classic = view()
  expect(classic.container.querySelector('.tab-btn.active')).toHaveAttribute('aria-label', 'Shows')
  classic.unmount()
  localStorage.setItem('arrview.ui.v1.layout', '"modern"'); localStorage.setItem('arrview.ui.v1.tab', '"movies"'); go('')
  view()
  await screen.findByRole('heading', { level: 1, name: 'Movies' })
  expect(window.location.hash).toBe('#/movies')
})

test('empty or unknown hashes are replaced without adding history entries (criterion 6)', async () => {
  const push = vi.spyOn(window.history, 'pushState'), replace = vi.spyOn(window.history, 'replaceState')
  go(''); const first = view()
  await screen.findByRole('heading', { level: 1, name: 'Downloads' })
  expect(window.location.hash).toBe('#/downloads')
  expect(push).not.toHaveBeenCalled(); expect(replace).toHaveBeenCalled()
  first.unmount()
  localStorage.setItem('arrview.ui.v1.tab', '"upcoming"'); go('#/nope')
  view()
  await screen.findByRole('heading', { level: 1, name: 'Upcoming' })
  expect(window.location.hash).toBe('#/upcoming')
  expect(push).not.toHaveBeenCalled()
})
test('a valid hash beats the preference, and an unavailable section goes to the first available one (D4, D5)', async () => {
  localStorage.setItem('arrview.ui.v1.tab', '"downloads"'); go('#/movies')
  const first = view()
  await screen.findByRole('heading', { level: 1, name: 'Movies' })
  first.unmount()
  go('#/shows/1')
  view({ radarr: config.radarr })
  await screen.findByRole('heading', { level: 1, name: 'Upcoming' })
  expect(window.location.hash).toBe('#/upcoming')
  expect(navNames()).toEqual(['Upcoming', 'Movies'])
})

test('nav links change the hash and the page; the active link has aria-current; detail routes mark their parent (criteria 5, 8)', async () => {
  go('#/downloads'); view()
  await screen.findByRole('heading', { level: 1, name: 'Downloads' })
  fireEvent.click(within(nav()).getByRole('link', { name: 'Shows' }))
  await screen.findByRole('heading', { level: 1, name: 'TV Shows' })
  expect(within(nav()).getByRole('link', { name: 'Shows' })).toHaveAttribute('aria-current', 'page')
  go('#/shows/1')
  await screen.findByRole('heading', { level: 1, name: 'Alpha Show' })
  expect(within(nav()).getByRole('link', { name: 'Shows' })).toHaveAttribute('aria-current', 'page')
  expect(within(nav()).getByRole('link', { name: 'Downloads' })).not.toHaveAttribute('aria-current')
})
test('focus moves to the h1 on a path change (criterion 31)', async () => {
  go('#/downloads'); view()
  await screen.findByRole('heading', { level: 1, name: 'Downloads' })
  go('#/upcoming')
  const heading = await screen.findByRole('heading', { level: 1, name: 'Upcoming' })
  await waitFor(() => expect(heading).toHaveFocus())
  expect(heading).toHaveAttribute('tabindex', '-1')
})

const ROUTES = [['#/downloads', 'Downloads'], ['#/shows', 'TV Shows'], ['#/shows/1', 'Alpha Show'], ['#/upcoming', 'Upcoming'], ['#/movies', 'Movies'],
  ['#/movies/11', 'Movie One'], ['#/search', 'Search'], ['#/settings', 'Settings'], ['#/shows/abc', 'Not found'], ['#/movies/999', 'Not found']]
for (const phone of [false, true]) {
  test(`every route has exactly one h1 and no skipped heading levels (${phone ? 'phone' : 'wide'})`, async () => {
    restoreMedia(); restoreMedia = stubMedia({ phone })
    for (const [hash, title] of ROUTES) {
      go(hash); const { unmount } = view()
      await screen.findByRole('heading', { level: 1, name: title })
      await waitFor(() => expect(document.querySelector('.empty-state .spinner')).toBeNull())
      const levels = [...document.querySelectorAll('.m-main h1, .m-main h2, .m-main h3, .m-main h4')].map(h => Number(h.tagName[1]))
      expect(levels.filter(l => l === 1), hash).toHaveLength(1)
      expect(levels[0], hash).toBe(1)
      levels.forEach((level, i) => { if (i) expect(level - levels[i - 1], `${hash} heading order`).toBeLessThanOrEqual(1) })
      unmount()
    }
  })
}

test('wide screens: top bar with brand, five links in order and a Settings gear; no pills or dots (criteria 8, 9, 10)', async () => {
  go('#/shows'); const { container } = view()
  await screen.findByRole('heading', { level: 1, name: 'TV Shows' })
  const banner = container.querySelector('.m-topbar')
  expect(within(banner).getByRole('link', { name: 'ArrView' })).toHaveAttribute('href', '#/downloads')
  expect(navNames()).toEqual(['Downloads', 'Shows', 'Upcoming', 'Movies', 'Search'])
  expect(within(banner).getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '#/settings')
  expect(screen.getAllByRole('link', { name: 'Settings' })).toHaveLength(1)
  expect(screen.getByRole('button', { name: 'Add Show' })).toHaveTextContent('Add Show')
  expect(container.querySelector('.service-pill, .status-dot')).toBeNull()
  expect(screen.getAllByRole('navigation')).toHaveLength(1)
})
test('phones: bottom nav without Settings, header + and gear, gear row on Downloads and Upcoming (criteria 8, 9)', async () => {
  restoreMedia(); restoreMedia = stubMedia({ phone: true })
  go('#/shows'); const { container } = view()
  await screen.findByRole('heading', { level: 1, name: 'TV Shows' })
  expect(container.querySelector('.m-topbar')).toBeNull()
  expect(navNames()).toEqual(['Downloads', 'Shows', 'Upcoming', 'Movies', 'Search'])
  expect(within(nav()).getByRole('link', { name: 'Shows' })).toHaveAttribute('aria-current', 'page')
  expect(screen.getByRole('button', { name: 'Add Show' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '#/settings')
  go('#/movies'); await screen.findByRole('button', { name: 'Add Movie' })
  go('#/search'); await screen.findByRole('heading', { level: 1, name: 'Search' })
  expect(screen.getByRole('link', { name: 'Settings' })).toBeInTheDocument()
  go('#/downloads'); await screen.findByRole('heading', { level: 1, name: 'Downloads' })
  expect(screen.getByRole('link', { name: 'Settings' })).toBeInTheDocument()
  go('#/settings'); await screen.findByRole('heading', { level: 1, name: 'Settings' })
  expect(screen.queryByRole('link', { name: 'Settings' })).toBeNull()
})
test('Settings Back returns to the last section, not history', async () => {
  go('#/movies'); view()
  await screen.findByRole('heading', { level: 1, name: 'Movies' })
  fireEvent.click(screen.getByRole('link', { name: 'Settings' }))
  await screen.findByRole('heading', { level: 1, name: 'Settings' })
  fireEvent.click(screen.getByRole('button', { name: /Back/ }))
  await screen.findByRole('heading', { level: 1, name: 'Movies' })
})
test('Add Show opens the existing add modal', async () => {
  go('#/shows'); view()
  fireEvent.click(await screen.findByRole('button', { name: 'Add Show' }))
  expect(await screen.findByRole('dialog')).toBeInTheDocument()
})

// ---- Service banner (criterion 10, D28) ----
const BANNER_ROWS = [
  ['#/downloads', ['SABnzbd', 'NZBHydra']], ['#/shows', ['Sonarr']], ['#/shows/1', ['Sonarr']], ['#/upcoming', ['Sonarr', 'Radarr']],
  ['#/movies', ['Radarr']], ['#/movies/11', ['Radarr']], ['#/search', ['NZBHydra', 'SABnzbd']], ['#/settings', []],
]
const pingOf = service => `/api/${service}/ping`
for (const [hash, expected] of BANNER_ROWS) {
  test(`banner strips on ${hash} follow the matrix when every service is offline`, async () => {
    stubFetch({ '/api/sabnzbd/ping': () => reply({}, false), '/api/nzbhydra/ping': () => reply({}, false), '/api/sonarr/ping': () => reply({}, false), '/api/radarr/ping': () => reply({}, false) })
    go(hash); view()
    await waitFor(() => expect(document.querySelectorAll('.m-banner')).toHaveLength(expected.length))
    expect([...document.querySelectorAll('.m-banner-text')].map(el => el.textContent)).toEqual(expected.map(name => `Can't reach ${name}`))
    for (const name of expected) {
      expect(screen.getByRole('button', { name: `Retry ${name}` })).toHaveTextContent('Retry')
    }
    if (expected.length) expect(screen.getAllByRole('link', { name: 'Settings' }).some(link => link.classList.contains('m-banner-btn'))).toBe(true)
  })
}
test('one offline service renders one strip; the other service stays quiet', async () => {
  stubFetch({ '/api/sabnzbd/ping': () => reply({}, false) })
  go('#/search'); view()
  await waitFor(() => expect(document.querySelectorAll('.m-banner')).toHaveLength(1))
  expect(screen.getByText("Can't reach SABnzbd")).toBeInTheDocument()
  expect(screen.queryByText("Can't reach NZBHydra")).toBeNull()
})
test('no banner before the first ping result or for an unconfigured service; Retry re-pings and the banner clears', async () => {
  let release, online = false
  const gate = new Promise(resolve => { release = resolve })
  const fetchMock = stubFetch({ '/api/sonarr/ping': async () => { if (!online) { await gate; return reply({}, false) } return reply({}) } })
  go('#/shows'); view({ sonarr: config.sonarr })
  await screen.findByRole('heading', { level: 1, name: 'TV Shows' })
  expect(document.querySelector('.m-banner')).toBeNull()
  await act(async () => { release() })
  await screen.findByText("Can't reach Sonarr")
  const pings = () => fetchMock.calls.filter(call => call.url === pingOf('sonarr')).length
  const before = pings(); online = true
  fireEvent.click(screen.getByRole('button', { name: 'Retry Sonarr' }))
  await waitFor(() => expect(pings()).toBe(before + 1))
  await waitFor(() => expect(document.querySelector('.m-banner')).toBeNull())
})
test('an unconfigured service never shows a banner', async () => {
  stubFetch({ '/api/radarr/ping': () => reply({}, false) })
  go('#/shows'); view({ sonarr: config.sonarr })
  await screen.findByRole('heading', { level: 1, name: 'TV Shows' })
  await act(async () => {})
  expect(document.querySelector('.m-banner')).toBeNull()
})
