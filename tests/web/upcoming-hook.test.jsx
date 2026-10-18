import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import useUpcoming from '../../src/hooks/useUpcoming'
import { calendarRange, radarrWindow } from '../../src/upcoming'
import { reply } from './modern-helpers'

const both = { sonarr: { url: 'http://sonarr.invalid', apikey: 'k' }, radarr: { url: 'http://radarr.invalid', apikey: 'k' } }
const air = new Date(2026, 9, 18, 21, 0).toISOString()
const episode = { id: 1, seriesId: 7, seasonNumber: 1, episodeNumber: 1, title: 'Pilot', airDateUtc: air, hasFile: false, series: { id: 7, title: 'Fixture Show' } }
const releaseDay = new Date()
releaseDay.setDate(releaseDay.getDate() + 3)
const film = { id: 5, title: 'Fixture Film', monitored: true, hasFile: false, isAvailable: true, digitalRelease: `${releaseDay.toISOString().slice(0, 10)}T00:00:00Z` }

// Routes: a map of URL prefix -> handler. Identify can be held with `hold`.
function routes(overrides = {}) {
  const calls = []
  const fn = vi.fn(async url => {
    url = String(url)
    calls.push(url)
    for (const [prefix, handler] of Object.entries(overrides)) if (url.startsWith(prefix)) return handler(url)
    if (url.startsWith('/api/arrview/identify')) return reply({ capabilities: ['radarrCalendar'] })
    if (url.startsWith('/api/sonarr/calendar')) return reply([episode])
    if (url.startsWith('/api/radarr/calendar')) return reply([film])
    return reply({})
  })
  fn.calls = calls
  vi.stubGlobal('fetch', fn)
  return fn
}
const count = (fn, prefix) => fn.calls.filter(url => url.startsWith(prefix)).length
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }

beforeEach(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }) })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

test('both services: requests carry the D2 windows and entries merge (criterion 6)', async () => {
  const fn = routes()
  const { result } = renderHook(() => useUpcoming(both))
  await waitFor(() => expect(result.current.loading).toBe(false))
  const query = prefix => new URL(fn.calls.find(url => url.startsWith(prefix)), 'http://x').searchParams
  const sonarr = query('/api/sonarr/calendar'), radarr = query('/api/radarr/calendar')
  const sRange = calendarRange(), rWindow = radarrWindow()
  expect(sonarr.get('start').slice(0, 10)).toBe(sRange.start.slice(0, 10))
  expect(sonarr.get('end').slice(0, 10)).toBe(sRange.end.slice(0, 10))
  expect(radarr.get('start').slice(0, 10)).toBe(rWindow.start.slice(0, 10))
  expect(radarr.get('end').slice(0, 10)).toBe(rWindow.end.slice(0, 10))
  expect(result.current.sources).toEqual({ tv: true, movies: true })
  expect(result.current.entries.map(e => e.kind).sort()).toEqual(['episode', 'movie'])
  expect(result.current.errors).toEqual({ sonarr: null, radarr: null })
})
test('no capability, failed identify, unconfigured Radarr or unconfigured Sonarr: the service is never requested and no error appears (criterion 6)', async () => {
  let fn = routes({ '/api/arrview/identify': () => reply({ capabilities: ['movieDelete'] }) })
  let hook = renderHook(() => useUpcoming(both))
  await waitFor(() => expect(hook.result.current.loading).toBe(false))
  expect(count(fn, '/api/radarr/calendar')).toBe(0)
  expect(hook.result.current.errors).toEqual({ sonarr: null, radarr: null })
  expect(hook.result.current.sources).toEqual({ tv: true, movies: false })
  hook.unmount()

  fn = routes({ '/api/arrview/identify': () => { throw new Error('offline') } })
  hook = renderHook(() => useUpcoming(both))
  await waitFor(() => expect(hook.result.current.loading).toBe(false))
  expect(count(fn, '/api/radarr/calendar')).toBe(0)
  expect(hook.result.current.errors.radarr).toBeNull()
  hook.unmount()

  fn = routes()
  hook = renderHook(() => useUpcoming({ sonarr: both.sonarr }))
  await waitFor(() => expect(hook.result.current.loading).toBe(false))
  expect(count(fn, '/api/radarr/calendar')).toBe(0)
  expect(count(fn, '/api/arrview/identify')).toBe(0)
  hook.unmount()

  fn = routes()
  hook = renderHook(() => useUpcoming({ radarr: both.radarr }))
  await waitFor(() => expect(hook.result.current.loading).toBe(false))
  expect(count(fn, '/api/sonarr/calendar')).toBe(0)
  expect(hook.result.current.entries.map(e => e.kind)).toEqual(['movie'])
})
test('deferred identify keeps loading true and movies off until it settles; loading never returns (D3, criterion 6)', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
  const gate = deferred()
  const fn = routes({ '/api/arrview/identify': () => gate.promise })
  const { result } = renderHook(() => useUpcoming(both))
  await act(async () => { await vi.advanceTimersByTimeAsync(10) })
  expect(count(fn, '/api/sonarr/calendar')).toBe(1)
  expect(result.current.loading).toBe(true)
  expect(result.current.sources).toEqual({ tv: true, movies: false })
  await act(async () => { gate.resolve(reply({ capabilities: ['radarrCalendar'] })); await vi.advanceTimersByTimeAsync(10) })
  expect(result.current.loading).toBe(false)
  expect(result.current.sources).toEqual({ tv: true, movies: true })
  const seen = []
  await act(async () => { await vi.advanceTimersByTimeAsync(60000); seen.push(result.current.loading) })
  await act(async () => { await result.current.retry('sonarr'); seen.push(result.current.loading) })
  expect(seen).toEqual([false, false])
  expect(count(fn, '/api/sonarr/calendar')).toBeGreaterThanOrEqual(2)
})
test('identify without the capability or rejected: loading ends once Sonarr answered, movies stay off, no error (D3)', async () => {
  const gate = deferred()
  routes({ '/api/arrview/identify': () => gate.promise })
  const first = renderHook(() => useUpcoming(both))
  await waitFor(() => expect(first.result.current.entries).toHaveLength(1))
  expect(first.result.current.loading).toBe(true)
  await act(async () => { gate.resolve(reply({ capabilities: [] })) })
  await waitFor(() => expect(first.result.current.loading).toBe(false))
  expect(first.result.current.sources.movies).toBe(false)
  first.unmount()

  const rejected = deferred()
  routes({ '/api/arrview/identify': () => rejected.promise })
  const second = renderHook(() => useUpcoming(both))
  await waitFor(() => expect(second.result.current.entries).toHaveLength(1))
  expect(second.result.current.loading).toBe(true)
  await act(async () => { rejected.reject(new Error('down')) })
  await waitFor(() => expect(second.result.current.loading).toBe(false))
  expect(second.result.current.errors).toEqual({ sonarr: null, radarr: null })
})
test('Radarr only with a failing identify: loading ends with no entries', async () => {
  routes({ '/api/arrview/identify': () => reply({}, false) })
  const { result } = renderHook(() => useUpcoming({ radarr: both.radarr }))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.entries).toEqual([])
  expect(result.current.sources).toEqual({ tv: false, movies: false })
})
test('one source failing keeps the other, retry refetches only that service, success clears the error (criterion 7)', async () => {
  let sonarrUp = false
  const fn = routes({ '/api/sonarr/calendar': () => (sonarrUp ? reply([episode]) : reply({}, false)) })
  const { result } = renderHook(() => useUpcoming(both))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.errors).toEqual({ sonarr: 'Cannot reach Sonarr', radarr: null })
  expect(result.current.entries.map(e => e.kind)).toEqual(['movie'])
  const radarrCalls = count(fn, '/api/radarr/calendar'), sonarrCalls = count(fn, '/api/sonarr/calendar')
  sonarrUp = true
  await act(async () => { await result.current.retry('sonarr') })
  expect(count(fn, '/api/radarr/calendar')).toBe(radarrCalls)
  expect(count(fn, '/api/sonarr/calendar')).toBe(sonarrCalls + 1)
  expect(result.current.errors.sonarr).toBeNull()
  expect(result.current.entries).toHaveLength(2)
})
test('a non-array body is a failure, and a failing refresh keeps the last entries with the error (criterion 7)', async () => {
  let mode = 'ok'
  routes({ '/api/sonarr/calendar': () => (mode === 'ok' ? reply([episode]) : mode === 'object' ? reply({ unexpected: true }) : reply({}, false)) })
  const { result } = renderHook(() => useUpcoming({ sonarr: both.sonarr }))
  await waitFor(() => expect(result.current.entries).toHaveLength(1))
  mode = 'object'
  await act(async () => { await result.current.retry('sonarr') })
  expect(result.current.errors.sonarr).toBe('Cannot reach Sonarr')
  expect(result.current.entries).toHaveLength(1)
  mode = 'fail'
  await act(async () => { await result.current.retry('sonarr') })
  expect(result.current.entries).toHaveLength(1)
  expect(result.current.errors.sonarr).toBe('Cannot reach Sonarr')
})
test('each source polls every 60 seconds (D20)', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
  const fn = routes()
  renderHook(() => useUpcoming(both))
  await act(async () => { await vi.advanceTimersByTimeAsync(10) })
  const sonarr = count(fn, '/api/sonarr/calendar'), radarr = count(fn, '/api/radarr/calendar')
  await act(async () => { await vi.advanceTimersByTimeAsync(60000) })
  expect(count(fn, '/api/sonarr/calendar')).toBe(sonarr + 1)
  expect(count(fn, '/api/radarr/calendar')).toBe(radarr + 1)
})
