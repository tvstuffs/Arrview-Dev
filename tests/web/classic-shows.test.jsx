import React from 'react'
import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react'
import ShowsTab from '../../src/components/ShowsTab'

// The Classic Shows tab counts what Sonarr wants, like the Modern pages. Delta: 10 episodes, 5 wanted, 4 on disk.
// Epsilon: 187 episodes, nothing monitored. Zeta: 100 episodes, 9 wanted, none on disk.
const show = (id, title, total, onDisk, wanted) => ({ id, title, titleSlug: title.toLowerCase(), status: 'continuing', year: 2020, monitored: true,
  seasons: [{ seasonNumber: 1, statistics: { totalEpisodeCount: total, episodeFileCount: onDisk, episodeCount: wanted } }] })
const series = [show(1, 'Delta Show', 10, 4, 5), show(2, 'Epsilon Show', 187, 0, 0), show(3, 'Zeta Show', 100, 0, 9)]
const reply = data => ({ ok: true, status: 200, json: async () => data })

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('arrview.ui.v1.layout', '"classic"')
  Object.defineProperty(document, 'hidden', { configurable: true, value: false })
  vi.stubGlobal('fetch', vi.fn(async url => String(url).startsWith('/api/sonarr/series') ? reply(series) : reply({})))
})
afterEach(() => vi.unstubAllGlobals())

const card = name => screen.getByRole('button', { name: `Episodes for ${name}` }).closest('.show-card-main')
const names = () => screen.getAllByRole('button', { name: /^Episodes for / }).map(b => b.getAttribute('aria-label').replace('Episodes for ', ''))

test('Classic: the caption, the bar and the missing badge follow what Sonarr wants', async () => {
  render(<ShowsTab onToast={() => {}} sonarrUrl="http://sonarr.invalid" onUpcoming={() => {}} />)
  await screen.findByRole('button', { name: 'Episodes for Delta Show' })
  const delta = card('Delta Show')
  expect(delta).toHaveTextContent('4/5 eps1 missing')
  expect(delta.querySelector('.progress-fill')).toHaveClass('is-high')
  expect(delta.querySelector('.progress-fill')).toHaveStyle({ width: '80%' })
  expect(within(delta).getByRole('button', { name: 'Search for all missing episodes' })).toBeInTheDocument()
  const epsilon = card('Epsilon Show')
  expect(epsilon).toHaveTextContent('Nothing wanted')
  expect(epsilon.querySelector('.progress-fill')).toHaveClass('is-none')
  expect(epsilon.querySelector('.missing-badge')).toBeNull()
  expect(within(epsilon).queryByRole('button', { name: 'Search for all missing episodes' })).toBeNull()
  expect(card('Zeta Show')).toHaveTextContent('0/9 eps9 missing')
})

test("Classic: a season's Search N Missing leaves out unmonitored episodes, in its count and in the ids it posts", async () => {
  const day = n => new Date(Date.now() + n * 86400000).toISOString()
  const eps = [
    { id: 11, seasonNumber: 1, episodeNumber: 1, title: 'One', hasFile: true, monitored: true, airDateUtc: day(-30) },
    { id: 12, seasonNumber: 1, episodeNumber: 2, title: 'Two', hasFile: false, monitored: true, airDateUtc: day(-20) },
    { id: 13, seasonNumber: 1, episodeNumber: 3, title: 'Three', hasFile: false, monitored: false, airDateUtc: day(-10) },
    { id: 14, seasonNumber: 1, episodeNumber: 4, title: 'Four', hasFile: false, monitored: true, airDateUtc: day(10) },
  ]
  const calls = []
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    calls.push({ url: String(url), init })
    if (String(url) === '/api/sonarr/series/1/episodes') return reply(eps)
    return String(url).startsWith('/api/sonarr/series') ? reply(series) : reply({ id: 5 })
  }))
  render(<ShowsTab onToast={() => {}} sonarrUrl="http://sonarr.invalid" onUpcoming={() => {}} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Episodes for Delta Show' }))
  expect(screen.queryByRole('button', { name: 'Search 2 Missing' })).toBeNull()
  fireEvent.click(await screen.findByRole('button', { name: 'Search 1 Missing' }))
  await waitFor(() => expect(calls.some(c => c.url === '/api/sonarr/command' && c.init?.method === 'POST')).toBe(true))
  expect(JSON.parse(calls.find(c => c.url === '/api/sonarr/command').init.body)).toEqual({ name: 'EpisodeSearch', episodeIds: [12] })
})

test('Classic: Has Missing and Most Missing count what Sonarr wants', async () => {
  render(<ShowsTab onToast={() => {}} sonarrUrl="http://sonarr.invalid" onUpcoming={() => {}} />)
  await screen.findByRole('button', { name: 'Episodes for Delta Show' })
  const chip = label => screen.getByText(label).closest('.stat-chip')
  expect(chip('Missing Episodes')).toHaveTextContent('10')
  fireEvent.change(screen.getByDisplayValue('A–Z'), { target: { value: 'missing' } })
  expect(names()).toEqual(['Zeta Show', 'Delta Show', 'Epsilon Show'])
  fireEvent.click(screen.getByRole('button', { name: 'Has Missing' }))
  expect(names()).toEqual(['Zeta Show', 'Delta Show'])
})
