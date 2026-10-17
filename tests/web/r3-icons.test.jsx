import React from 'react'
import fs from 'node:fs'
import path from 'node:path'
import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import Icon from '../../src/components/Icon'
import ShowsTab from '../../src/components/ShowsTab'
import MoviesTab from '../../src/components/MoviesTab'
import DownloadsTab from '../../src/components/DownloadsTab'
import ReleaseSearchModal from '../../src/components/ReleaseSearchModal'
import NzbSearchModal from '../../src/components/NzbSearchModal'
import { MonitorToggle } from '../../src/components/MediaControls'

const reply = (data, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => data })
const past = new Date(Date.now() - 86400000 * 30).toISOString()
const pathOf = (name, weight) => render(<Icon name={name} weight={weight} />).container.querySelector('path').getAttribute('d')
const downFetch = () => vi.fn(async () => reply({ error: 'connection refused' }, false))

afterEach(() => vi.unstubAllGlobals())
beforeEach(() => {
  localStorage.clear()
  Object.defineProperty(document, 'hidden', { configurable: true, value: false })
})

test('the six Phosphor icons added in round 3 are defined', () => {
  for (const name of ['info', 'warning', 'question', 'newspaper', 'plant', 'arrow-up']) expect(pathOf(name, 'regular'), name).toMatch(/^M/)
  expect(pathOf('info', 'fill')).not.toBe(pathOf('info', 'regular'))
})

test('episode: info toggle keeps its name and state; downloaded badge shows the Downloaded label', async () => {
  localStorage.setItem('arrview.ui.v1.shows.expanded', '1')
  localStorage.setItem('arrview.ui.v1.show.1.seasons', '[1]')
  const series = [{ id: 1, title: 'Show', titleSlug: 'show', status: 'continuing', year: 2020, seasons: [{ seasonNumber: 1, statistics: { totalEpisodeCount: 1, episodeFileCount: 1 } }] }]
  const episodes = [{ id: 10, seasonNumber: 1, episodeNumber: 1, title: 'Pilot', hasFile: true, airDateUtc: past, overview: 'About the pilot' }]
  vi.stubGlobal('fetch', vi.fn(async url => String(url).startsWith('/api/sonarr/series/1/episodes') ? reply(episodes) : reply(series)))
  const { container } = render(<ShowsTab onToast={() => {}} sonarrUrl="http://sonarr.invalid" onUpcoming={() => {}} />)
  const toggle = await screen.findByRole('button', { name: 'Show episode description' })
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  expect(toggle.querySelector('path').getAttribute('d')).toBe(pathOf('info', 'regular'))
  fireEvent.click(toggle)
  expect(screen.getByRole('button', { name: 'Show episode description' })).toHaveAttribute('aria-expanded', 'true')
  const badge = container.querySelector('.badge-success.text-xs')
  expect(badge).toHaveTextContent('Downloaded')
  expect(badge.querySelector('svg path').getAttribute('d')).toBe(pathOf('check', 'regular'))
})

test('Cannot reach error states show the warning icon', async () => {
  const warning = pathOf('warning', 'regular')
  for (const [Tab, props, text] of [[DownloadsTab, {}, 'Cannot reach SABnzbd'], [MoviesTab, {}, 'Cannot reach Radarr'], [ShowsTab, {}, 'Cannot reach Sonarr']]) {
    vi.stubGlobal('fetch', downFetch())
    const { container, unmount } = render(<Tab onToast={() => {}} {...props} />)
    await screen.findByText(text)
    expect(container.querySelector('.empty-state-icon svg path').getAttribute('d'), text).toBe(warning)
    unmount()
  }
})

test('release search: warning on error, question on empty, protocol icons with labels, seeders with a name', async () => {
  const warning = pathOf('warning', 'regular')
  const question = pathOf('question', 'regular')
  const episode = { id: 1, seasonNumber: 1, episodeNumber: 1, title: 'Pilot' }
  vi.stubGlobal('fetch', downFetch())
  let view = render(<ReleaseSearchModal episode={episode} seriesTitle="Show" onClose={() => {}} onToast={() => {}} />)
  await screen.findByText('connection refused')
  expect(document.body.querySelector('.ep-search-empty svg path').getAttribute('d')).toBe(warning)
  view.unmount()

  vi.stubGlobal('fetch', vi.fn(async () => reply([])))
  view = render(<ReleaseSearchModal episode={episode} seriesTitle="Show" onClose={() => {}} onToast={() => {}} />)
  await screen.findByText('No results found from any indexer')
  expect(document.body.querySelector('.ep-search-empty svg path').getAttribute('d')).toBe(question)
  view.unmount()

  const release = (guid, protocol, extra = {}) => ({ guid, title: `Release ${guid}`, protocol, indexer: 'Idx', approved: true, rejections: [], ...extra })
  vi.stubGlobal('fetch', vi.fn(async () => reply([release('a', 'usenet'), release('b', 'torrent', { seeders: 12 })])))
  view = render(<ReleaseSearchModal episode={episode} seriesTitle="Show" onClose={() => {}} onToast={() => {}} />)
  await screen.findByText('Release a')
  const badge = label => [...document.body.querySelectorAll('.badge')].find(b => b.textContent === label)
  expect(badge('Usenet').querySelector('path').getAttribute('d')).toBe(pathOf('newspaper', 'regular'))
  expect(badge('Torrent').querySelector('path').getAttribute('d')).toBe(pathOf('plant', 'regular'))
  const seeders = screen.getByRole('img', { name: '12 seeders' })
  expect(seeders).toHaveTextContent('12')
  expect(seeders.querySelector('path').getAttribute('d')).toBe(pathOf('arrow-up', 'regular'))
  expect(seeders.textContent).not.toMatch(/[←-⇿]/)
})

test('NZB search: warning on error, question on no results', async () => {
  const run = async (response, expectedText) => {
    vi.stubGlobal('fetch', vi.fn(async () => response))
    const view = render(<NzbSearchModal embedded onClose={() => {}} onToast={() => {}} />)
    const input = screen.getByPlaceholderText(/Search for something/)
    fireEvent.change(input, { target: { value: 'thing' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    await screen.findByText(expectedText)
    const d = view.container.querySelector('.nzb-empty-icon svg path').getAttribute('d')
    view.unmount()
    return d
  }
  expect(await run(reply({ error: 'hydra down' }, false), 'hydra down')).toBe(pathOf('warning', 'regular'))
  expect(await run(reply([]), 'No results found')).toBe(pathOf('question', 'regular'))
})

test('monitor toggle keeps one width: both states are always laid out in one grid cell', async () => {
  let resolve
  const onChanged = vi.fn(async () => {})
  vi.stubGlobal('fetch', vi.fn(() => new Promise(r => { resolve = () => r(reply({})) })))
  const { container } = render(<MonitorToggle media={{ id: 1, title: 'Show', monitored: true }} service="sonarr" onChanged={onChanged} onToast={() => {}} />)
  const button = screen.getByRole('button', { name: 'Monitored: Show' })
  const states = () => [...button.children].map(c => ({ cls: c.className, text: c.textContent }))
  expect(button).toHaveAttribute('aria-pressed', 'true')
  expect(button).not.toHaveAttribute('aria-busy')
  const idle = states()
  expect(idle).toHaveLength(2)
  expect(idle.map(s => s.text)).toEqual(['', 'Saving…'])
  expect(idle[0].cls).not.toMatch(/monitor-hidden/)
  expect(idle[1].cls).toMatch(/monitor-hidden/)
  fireEvent.click(button)
  await waitFor(() => expect(button).toHaveAttribute('aria-busy', 'true'))
  const busy = states()
  expect(busy).toHaveLength(2)
  expect(busy[0].cls).toMatch(/monitor-hidden/)
  expect(busy[1].cls).not.toMatch(/monitor-hidden/)
  expect(button).toHaveAccessibleName('Monitored: Show')
  resolve()
  await waitFor(() => expect(onChanged).toHaveBeenCalled())
  await waitFor(() => expect(button).not.toHaveAttribute('aria-busy'))
  expect(container.querySelector('.monitor-toggle')).not.toBeNull()
})

test('monitor toggle CSS stacks both states in one grid cell and hides the inactive one without removing it', () => {
  const css = fs.readFileSync(path.resolve(__dirname, '../../src/index.css'), 'utf8')
  expect(css).toMatch(/\.btn-icon\.monitor-toggle\s*\{[^}]*display:\s*inline-grid[^}]*\}/)
  expect(css).toMatch(/\.monitor-toggle\s*>\s*span\s*\{[^}]*grid-area:\s*1\s*\/\s*1[^}]*\}/)
  expect(css).toMatch(/\.monitor-hidden\s*\{\s*visibility:\s*hidden/)
})
