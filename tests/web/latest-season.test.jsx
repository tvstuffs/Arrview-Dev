import React from 'react'
import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { LibraryProvider } from '../../src/components/modern/LibraryProvider'
import ShowPage from '../../src/components/modern/ShowPage'
import ShowsTab from '../../src/components/ShowsTab'
import { latestSeason, latestOnly } from '../../src/media'
import { config, series, episodes, reply, stubFetch, stubMedia, resetEnvironment } from './modern-helpers'

// "Monitor latest season only" for a continuing show with two or more main seasons: the latest season is the newest one that has
// episodes in Sonarr; it and any season after it (announced, no episodes yet) stay monitored, the earlier seasons are unmonitored,
// the specials are left alone and the show itself is monitored. The button sends { monitored: true, fromSeason: <latest> } to the
// all-seasons route.

let restoreMedia
beforeEach(() => { resetEnvironment(); restoreMedia = stubMedia({ phone: false }); window.scrollTo = vi.fn() })
afterEach(() => { restoreMedia(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

const detail = (id = '1', toast = vi.fn()) => render(<LibraryProvider><ShowPage id={id} phone={false} onToast={toast} config={config} /></LibraryProvider>)
const puts = fetchMock => fetchMock.calls.filter(c => c.init?.method === 'PUT').map(c => ({ url: c.url, body: JSON.parse(c.init.body) }))
const ep = (id, seasonNumber, monitored = true) => ({ id, seasonNumber, episodeNumber: id % 100, monitored })

test('latestSeason: the newest main season with episodes; an announced season without them is passed over; null under two', () => {
  const show = { seasons: [0, 1, 2, 3, 4].map(seasonNumber => ({ seasonNumber })) }
  expect(latestSeason(show, [ep(1, 0), ep(101, 1), ep(201, 2), ep(301, 3)])).toBe(3)
  // No episodes known yet: the highest-numbered main season.
  expect(latestSeason(show, [])).toBe(4)
  // The specials never count, and a show with one main season has no choice to make.
  expect(latestSeason({ seasons: [{ seasonNumber: 0 }, { seasonNumber: 1 }] }, [ep(1, 0), ep(101, 1)])).toBeNull()
  expect(latestSeason({ seasons: [] }, [])).toBeNull()
})

test('latestOnly: the show monitored, the latest season and any after it on, every earlier season off', () => {
  const show = { monitored: true, seasons: [{ seasonNumber: 0, monitored: true }, { seasonNumber: 1, monitored: false }, { seasonNumber: 2, monitored: true }, { seasonNumber: 3, monitored: true }] }
  const eps = [ep(1, 0, true), ep(101, 1, false), ep(102, 1, false), ep(201, 2, true), ep(202, 2, true)]
  expect(latestOnly(show, eps)).toBe(true)
  // An earlier season still on, one of its episodes still monitored, the latest season partly off, or the show unmonitored: no.
  expect(latestOnly({ ...show, seasons: show.seasons.map(s => (s.seasonNumber === 1 ? { ...s, monitored: true } : s)) }, eps)).toBe(false)
  expect(latestOnly(show, eps.map(e => (e.id === 102 ? { ...e, monitored: true } : e)))).toBe(false)
  expect(latestOnly(show, eps.map(e => (e.id === 202 ? { ...e, monitored: false } : e)))).toBe(false)
  expect(latestOnly({ ...show, monitored: false }, eps)).toBe(false)
})

test('Modern: a continuing show has "Monitor latest season only" beside "Monitor all seasons"; a press keeps only season 2', async () => {
  const fetchMock = stubFetch({ '/api/sonarr/series/1/seasons': () => reply({ success: true, monitored: true, seasons: 2, fromSeason: 2 }) })
  const toast = vi.fn(); detail('1', toast)
  const button = await screen.findByRole('button', { name: 'Monitor only the latest season of Alpha Show, season 2' })
  expect(button).toHaveTextContent('Monitor latest season only')
  expect(button).toHaveAttribute('title', 'Monitor season 2 and unmonitor the earlier seasons')
  expect(button.closest('.m-seasons-head')).toContainElement(screen.getByRole('button', { name: /all seasons/i }))
  fireEvent.click(button)
  await waitFor(() => expect(puts(fetchMock)).toEqual([{ url: '/api/sonarr/series/1/seasons', body: { monitored: true, fromSeason: 2 } }]))
  await waitFor(() => expect(toast).toHaveBeenCalledWith('Season 2 is monitored in Sonarr, and the earlier seasons are not', 'info'))
})

test('Modern: when only the latest season is monitored the button says so and does nothing', async () => {
  const only = series.map(s => (s.id === 1 ? { ...s, seasons: s.seasons.map(season => ({ ...season, monitored: season.seasonNumber !== 1 })) } : s))
  const eps = episodes.map(e => ({ ...e, monitored: e.seasonNumber !== 1 }))
  const fetchMock = stubFetch({}, { series: only, episodes: eps }); detail('1')
  const button = await screen.findByRole('button', { name: 'Only the latest season of Alpha Show is monitored, season 2' })
  expect(button).toHaveTextContent('Latest season only')
  expect(button).toBeDisabled()
  fireEvent.click(button)
  expect(puts(fetchMock)).toEqual([])
})

test('Modern: no latest-season button for an ended show or a show with one main season', async () => {
  stubFetch({}, { series: series.map(s => (s.id === 1 ? { ...s, status: 'ended' } : s)) })
  const ended = detail('1')
  await screen.findByRole('button', { name: /all seasons/i })
  expect(screen.queryByRole('button', { name: /latest season/ })).toBeNull()
  ended.unmount()
  stubFetch({}, { episodes: episodes.filter(e => e.seasonNumber === 1) })
  detail('1')
  await screen.findByRole('button', { name: 'Monitored, Season 1. Press to unmonitor' })
  expect(screen.queryByRole('button', { name: /latest season/ })).toBeNull()
})

test('Classic: the same button sits beside "Monitor all seasons" above the seasons', async () => {
  const two = { ...series[0], id: 1, title: 'Delta Show', seasons: [1, 2].map(seasonNumber => ({ seasonNumber, monitored: true, statistics: { totalEpisodeCount: 2, episodeFileCount: 0, episodeCount: 2 } })) }
  const eps = [1, 2].flatMap(sn => [1, 2].map(n => ({ id: sn * 10 + n, seasonNumber: sn, episodeNumber: n, title: `S${sn}E${n}`, hasFile: false, monitored: true, airDateUtc: new Date(Date.now() - n * 86400000).toISOString() })))
  const calls = []
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    calls.push({ url: String(url), init })
    if (String(url) === '/api/sonarr/series/1/seasons') return reply({ success: true, monitored: true, seasons: 2, fromSeason: 2 })
    if (String(url) === '/api/sonarr/series/1/episodes') return reply(eps)
    return String(url).startsWith('/api/sonarr/series') ? reply([two]) : reply({})
  }))
  const toast = vi.fn()
  render(<ShowsTab onToast={toast} sonarrUrl="http://sonarr.invalid" onUpcoming={() => {}} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Episodes for Delta Show' }))
  const latest = await screen.findByRole('button', { name: 'Monitor only the latest season of Delta Show, season 2' })
  expect(latest.closest('.show-seasons-head')).toContainElement(screen.getByRole('button', { name: /all seasons/i }))
  fireEvent.click(latest)
  await waitFor(() => expect(calls.some(c => c.url === '/api/sonarr/series/1/seasons' && c.init?.method === 'PUT')).toBe(true))
  expect(JSON.parse(calls.find(c => c.url === '/api/sonarr/series/1/seasons').init.body)).toEqual({ monitored: true, fromSeason: 2 })
  await waitFor(() => expect(toast).toHaveBeenCalledWith('Season 2 is monitored in Sonarr, and the earlier seasons are not', 'info'))
})
