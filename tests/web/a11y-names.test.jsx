import React from 'react'
import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import Dashboard from '../../src/components/Dashboard'
import DownloadsTab from '../../src/components/DownloadsTab'
import ShowsTab from '../../src/components/ShowsTab'
import MoviesTab from '../../src/components/MoviesTab'
import Sheet from '../../src/components/Sheet'

const reply = data => ({ ok: true, status: 200, json: async () => data })
const GLYPHS = /[\u{1F000}-\u{1FAFF}←-⇿⌀-⏿①-➿⤀-⯿ℹ■-◿️]/u
const past = new Date(Date.now() - 86400000 * 30).toISOString()

const series = [{ id: 1, title: 'Show', titleSlug: 'show', status: 'continuing', year: 2020, seasons: [{ seasonNumber: 1, statistics: { totalEpisodeCount: 2, episodeFileCount: 1 } }] }]
const episodes = [
  { id: 10, seasonNumber: 1, episodeNumber: 1, title: 'Pilot', hasFile: true, airDateUtc: past, overview: 'About the pilot' },
  { id: 11, seasonNumber: 1, episodeNumber: 2, title: 'Second', hasFile: false, airDateUtc: past },
]
const movies = [{ id: 5, title: 'Movie', year: 2024, hasFile: false, monitored: true, isAvailable: true }]
const slots = [{ nzo_id: 'a', filename: 'Active', status: 'Downloading', percentage: '10', mb: '100', mbleft: '90' },
  { nzo_id: 'b', filename: 'Held', status: 'Paused', percentage: '10', mb: '100', mbleft: '90' }]

function route(url) {
  if (url.startsWith('/api/sonarr/series/1/episodes')) return reply(episodes)
  if (url.startsWith('/api/sonarr/series')) return reply(series)
  if (url.startsWith('/api/radarr/movies')) return reply(movies)
  if (url.startsWith('/api/arrview/identify')) return reply({ capabilities: [] })
  if (url.startsWith('/api/sabnzbd/queue')) return reply({ queue: { status: 'Downloading', slots } })
  if (url.startsWith('/api/sabnzbd/history')) return reply({ history: { slots: [] } })
  if (url.includes('/ping')) return reply({})
  return reply({})
}
beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('arrview.ui.v1.layout', '"classic"')
  Object.defineProperty(document, 'hidden', { configurable: true, value: false })
  vi.stubGlobal('fetch', vi.fn(async url => route(String(url))))
})
afterEach(() => vi.unstubAllGlobals())

const nameOf = el => el.getAttribute('aria-label') ?? el.textContent.replace(/\s+/g, ' ').trim()
function expectNoGlyphNames(root = document.body) {
  for (const el of root.querySelectorAll('button, a[href]')) expect(nameOf(el), `name of ${el.outerHTML.slice(0, 80)}`).not.toMatch(GLYPHS)
}

test('queue and downloads controls keep their accessible names', async () => {
  render(<DownloadsTab onToast={() => {}} />)
  for (const name of ['Pause', 'Resume', 'Delete', 'Refresh downloads', 'Search NZBs', 'Pause All']) {
    expect((await screen.findAllByRole('button', { name })).length).toBeGreaterThan(0)
  }
  expect(screen.getByRole('button', { name: 'Pause' })).toHaveAttribute('title', 'Pause')
  expectNoGlyphNames()
})
test('show rows, seasons and episodes keep their accessible names', async () => {
  localStorage.setItem('arrview.ui.v1.shows.expanded', '1')
  localStorage.setItem('arrview.ui.v1.show.1.seasons', '[1]')
  render(<ShowsTab onToast={() => {}} sonarrUrl="http://sonarr.invalid" onUpcoming={() => {}} />)
  await screen.findByRole('button', { name: 'Remove Show from Sonarr' })
  await screen.findByRole('button', { name: 'Delete and unmonitor Pilot' })
  expect(screen.getByRole('button', { name: 'Delete and unmonitor Pilot' })).toHaveAttribute('title', 'Delete from disk and unmonitor')
  expect(screen.getByRole('button', { name: 'Show episode description' })).toHaveAttribute('aria-expanded', 'false')
  expect(screen.getByRole('button', { name: 'Interactive search — pick a release manually' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Search for all missing episodes' })).toHaveAttribute('title', 'Search for all missing episodes')
  expect(screen.getByRole('button', { name: 'Delete downloaded files in Season 1' })).toHaveAttribute('title', 'Delete downloaded files in Season 1')
  expect(screen.getByRole('button', { name: 'Remove Show from Sonarr' })).toHaveAttribute('title', 'Remove Show from Sonarr')
  const sonarr = screen.getByRole('link', { name: 'Open in Sonarr' })
  expect(sonarr).toHaveAttribute('title', 'Open in Sonarr')
  const monitor = screen.getByRole('button', { name: 'Monitored: Show' })
  expect(monitor).toHaveAttribute('aria-pressed', 'false')
  expect(monitor).toHaveAttribute('title', 'Unmonitored')
  expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('button', { name: 'Has Missing' })).toHaveAttribute('aria-pressed', 'false')
  expectNoGlyphNames()
})
for (const view of ['list', 'posters']) {
  test(`movie ${view} actions keep their accessible names`, async () => {
    localStorage.setItem('arrview.ui.v1.movies.view', JSON.stringify(view))
    render(<MoviesTab onToast={() => {}} />)
    expect(await screen.findByRole('button', { name: 'Delete Movie' })).toHaveAttribute('title', 'Delete Movie')
    expect(screen.getByRole('button', { name: 'Monitored: Movie' })).toHaveAttribute('title', 'Monitored')
    expect(screen.getByRole('button', { name: 'Interactive Search' })).toHaveAttribute('title', 'Interactive Search')
    expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Download All Missing (1)' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: view === 'posters' ? 'Posters' : 'List' })).toHaveAttribute('aria-pressed', 'true')
    expectNoGlyphNames()
  })
}
test('sheet close keeps its name and gains a matching title', () => {
  render(<Sheet title="Example" onClose={() => {}}>body</Sheet>)
  const close = screen.getByRole('button', { name: 'Close dialog' })
  expect(close).toHaveAttribute('title', 'Close dialog')
})
test('dashboard exposes exactly one Settings control and a gear only on phones', async () => {
  const config = { sabnzbd: { url: 'http://a.invalid', apikey: 'k' }, sonarr: { url: 'http://b.invalid', apikey: 'k' }, radarr: { url: 'http://c.invalid', apikey: 'k' }, nzbhydra: { url: 'http://d.invalid', apikey: 'k' } }
  const original = window.matchMedia
  vi.stubGlobal('EventSource', class { addEventListener() {} close() {} })
  for (const phone of [false, true]) {
    const query = new EventTarget()
    query.matches = phone
    window.matchMedia = () => query
    const { unmount } = render(<Dashboard config={config} onConfigSaved={() => {}} />)
    const nav = screen.getByRole('navigation', { name: 'Main navigation' })
    const settings = screen.getAllByRole('button', { name: /settings/i })
    expect(settings).toHaveLength(1)
    expect(settings[0]).toHaveAccessibleName(phone ? 'Open settings' : 'Settings')
    expect(within(nav).queryAllByRole('button')).toHaveLength(phone ? 5 : 6)
    expectNoGlyphNames()
    unmount()
  }
  window.matchMedia = original
})
