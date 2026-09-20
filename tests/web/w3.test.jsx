import React from 'react'
import { test, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import ReleaseSearchModal from '../../src/components/ReleaseSearchModal'
import { supportsMovieRemoval, MonitorToggle } from '../../src/components/MediaControls'
import { calendarRange, episodeStatus } from '../../src/components/UpcomingTab'
import { deleteMovieAndUnmonitor } from '../../src/actions'
import DownloadsTab from '../../src/components/DownloadsTab'
import MoviesTab from '../../src/components/MoviesTab'
const reply = (data, ok = true) => ({ ok, status: ok ? 200 : 503, json: async () => data })
beforeEach(() => { localStorage.clear(); Object.defineProperty(document, 'hidden', { configurable: true, value: false }) })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

test('movie release search uses Radarr query/grab, preserves payload and reports HTTP errors', async () => {
  const release = { guid: 'r1', indexerId: 9, title: 'Movie release', approved: true }
  const fetch = vi.fn().mockResolvedValueOnce(reply([release])).mockResolvedValueOnce(reply({}, false))
  vi.stubGlobal('fetch', fetch); const toast = vi.fn()
  render(<ReleaseSearchModal movie={{ id: 42, title: 'A Movie', year: 2025 }} onClose={() => {}} onToast={toast} />)
  await screen.findByText('Movie release')
  expect(fetch.mock.calls[0][0]).toBe('/api/radarr/release?movieId=42&title=A+Movie&year=2025')
  fireEvent.click(screen.getByRole('button', { name: /Grab/ }))
  await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.stringContaining('Grab failed'), 'error'))
  expect(fetch.mock.calls[1]).toEqual(['/api/radarr/release', expect.objectContaining({ method: 'POST', body: JSON.stringify(release) })])
})
test('Hydra movie fallback sends NZB URL to SABnzbd, not Radarr', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(reply([{ guid: 'h1', title: 'Hydra movie', _source: 'nzbhydra', _nzbUrl: 'https://example.invalid/a.nzb' }])).mockResolvedValue(reply({}))
  vi.stubGlobal('fetch', fetch)
  render(<ReleaseSearchModal movie={{ id: 1, title: 'Movie' }} onClose={() => {}} onToast={() => {}} />)
  fireEvent.click(await screen.findByRole('button', { name: /Grab/ }))
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
  expect(fetch.mock.calls[1][0]).toBe('/api/sabnzbd/addurl')
})
test('movie deletion stops on failed file delete and reports partial monitor failure', async () => {
  const fetch = vi.fn().mockResolvedValue(reply({ error: 'delete failed' }, false)); vi.stubGlobal('fetch', fetch)
  const movie = { id: 3, hasFile: true, movieFile: { id: 30 } }
  await expect(deleteMovieAndUnmonitor(movie)).rejects.toThrow('delete failed')
  expect(fetch).toHaveBeenCalledTimes(1)
  fetch.mockReset().mockResolvedValueOnce(reply({})).mockResolvedValueOnce(reply({}, false))
  await expect(deleteMovieAndUnmonitor(movie)).rejects.toThrow('could not unmonitor')
  expect(fetch.mock.calls.map(call => call[0])).toEqual(['/api/radarr/moviefile/30', '/api/radarr/movie/monitor'])
  fetch.mockReset()
  await expect(deleteMovieAndUnmonitor({ id: 3, hasFile: true })).rejects.toThrow('details are unavailable')
  expect(fetch).not.toHaveBeenCalled()
})
test('movie removal is gated conservatively with legacy 1.08 compatibility', () => {
  for (const version of ['1.07', '', 'garbage']) expect(supportsMovieRemoval({ version })).toBe(false)
  for (const version of ['1.08', '1.10.2', '2.0']) expect(supportsMovieRemoval({ version })).toBe(true)
  expect(supportsMovieRemoval({ capabilities: ['movieDelete'] })).toBe(true)
})
test('series monitoring sends only boolean and refreshes after success', async () => {
  const fetch = vi.fn().mockResolvedValue(reply({})), refresh = vi.fn(); vi.stubGlobal('fetch', fetch)
  render(<MonitorToggle media={{ id: 9, title: 'Show', monitored: true }} service="sonarr" onChanged={refresh} onToast={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: 'Monitored: Show' }))
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
  expect(fetch.mock.calls[0]).toEqual(['/api/sonarr/series/9', expect.objectContaining({ body: '{"monitored":false}', method: 'PUT' })])
})
test('calendar range uses local day boundaries and statuses prioritize downloaded', () => {
  const now = new Date(2026, 8, 19, 12), range = calendarRange(now)
  expect(new Date(range.start).getDate()).toBe(18)
  expect(new Date(range.start).getHours()).toBe(0)
  expect(new Date(range.end).getDate()).toBe(3)
  expect(new Date(range.end).getHours()).toBe(23)
  expect(episodeStatus({ hasFile: true, airDateUtc: '2099-01-01' }, now.getTime())).toBe('Downloaded')
  expect(episodeStatus({ airDateUtc: '2020-01-01' }, now.getTime())).toBe('Missing')
  expect(episodeStatus({ airDateUtc: '2099-01-01' }, now.getTime())).toBe('Upcoming')
})
test('downloads poll every 2 seconds active, 10 idle, and stop when hidden', async () => {
  vi.useFakeTimers(); let status = 'Downloading'
  const fetch = vi.fn(async url => reply(url.includes('/queue') ? { queue: { status, slots: [] } } : { history: { slots: [] } })); vi.stubGlobal('fetch', fetch)
  render(<DownloadsTab onToast={() => {}} />); await act(async () => {})
  fetch.mockClear(); await act(async () => vi.advanceTimersByTimeAsync(2000)); expect(fetch).toHaveBeenCalledTimes(2)
  status = 'Idle'; await act(async () => vi.advanceTimersByTimeAsync(2000)); fetch.mockClear()
  await act(async () => vi.advanceTimersByTimeAsync(9999)); expect(fetch).not.toHaveBeenCalled()
  await act(async () => vi.advanceTimersByTimeAsync(1)); expect(fetch).toHaveBeenCalledTimes(2)
  Object.defineProperty(document, 'hidden', { configurable: true, value: true }); act(() => document.dispatchEvent(new Event('visibilitychange')))
  fetch.mockClear(); await act(async () => vi.advanceTimersByTimeAsync(20000)); expect(fetch).not.toHaveBeenCalled()
})
test('history load more increases limit and disappears at total', async () => {
  vi.stubGlobal('fetch', vi.fn(async url => reply(url.includes('/queue') ? { queue: { slots: [] } } : { history: { noofslots: 16, slots: Array.from({ length: url.includes('limit=30') ? 16 : 15 }, (_, i) => ({ nzo_id: String(i), name: `Item ${i}`, status: 'Completed' })) } })))
  render(<DownloadsTab onToast={() => {}} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Load more' }))
  await screen.findByText('Item 15'); expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull()
})
test('recently downloaded sorts by file import date, view persists, legacy removal is explained', async () => {
  vi.stubGlobal('fetch', vi.fn(async url => reply(url.includes('identify') ? { version: '1.07' } : [
    { id: 1, title: 'Older import', hasFile: true, movieFile: { id: 10, dateAdded: '2020-01-01' } },
    { id: 2, title: 'Recent import', hasFile: true, movieFile: { id: 20, dateAdded: '2026-01-01' } },
  ])))
  const view = render(<MoviesTab onToast={() => {}} />); await screen.findByText('Older import')
  fireEvent.change(screen.getByLabelText('Sort results'), { target: { value: 'downloaded' } })
  expect([...document.querySelectorAll('.movie-title')].map(el => el.textContent)).toEqual(['Recent import', 'Older import'])
  fireEvent.click(screen.getByRole('button', { name: 'Posters', exact: true })); expect(localStorage.getItem('arrview.ui.v1.movies.view')).toBe('"posters"')
  fireEvent.click(screen.getByRole('button', { name: 'Delete Recent import' }))
  expect(screen.getByText(/needs ArrView Server 1.08/)).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Delete and Remove from Radarr' })).toBeNull(); view.unmount()
})
