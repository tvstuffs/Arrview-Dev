import { test, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import useSeriesEpisodes from '../../src/hooks/useSeriesEpisodes'

// The hook behind the episode titles in Recent History (2.0): one request per show while a row needs it, two at a time,
// a retry after two minutes for a list that could not be read, a fresh read after ten minutes for a list that lacks an
// episode a row names, and nothing at all while Sonarr is not set up.
const T0 = Date.parse('2026-11-27T15:00:00Z')
const reply = (data, ok = true) => ({ ok, status: ok ? 200 : 503, json: async () => data })
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const episode = (seasonNumber, episodeNumber, title) => ({ id: seasonNumber * 100 + episodeNumber, seasonNumber, episodeNumber, title,
  overview: 'not kept', images: [{ coverType: 'screenshot', remoteUrl: 'https://img.invalid/still.jpg' }] })
const need = (seriesId, season, number) => ({ seriesId, season, number })
const urlsOf = fn => fn.mock.calls.map(([url]) => String(url))

function stub(answer) {
  const fn = vi.fn(async url => answer(String(url)))
  vi.stubGlobal('fetch', fn)
  return fn
}
const fakeDate = () => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(T0) }
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

test('each show is fetched once, through the show page route, and only the season, number and title are kept', async () => {
  const fn = stub(url => reply(url.includes('/series/4/') ? [episode(2, 6, 'The Sixth'), episode(2, 7, 'The Seventh')] : [episode(1, 1, 'Pilot')]))
  const { result, rerender } = renderHook(({ needs }) => useSeriesEpisodes(needs, { now: 1 }),
    { initialProps: { needs: [need(4, 2, 6), need(4, 2, 7), need(9, 1, 1)] } })
  await waitFor(() => expect(result.current.size).toBe(2))
  expect(urlsOf(fn).sort()).toEqual(['/api/sonarr/series/4/episodes', '/api/sonarr/series/9/episodes'])
  expect(result.current.get(4)).toEqual([{ seasonNumber: 2, episodeNumber: 6, title: 'The Sixth' }, { seasonNumber: 2, episodeNumber: 7, title: 'The Seventh' }])
  // The same rows again, in another order, and later ticks of the clock ask for nothing new.
  rerender({ needs: [need(9, 1, 1), need(4, 2, 7), need(4, 2, 6)] })
  await act(async () => { await new Promise(done => setTimeout(done, 20)) })
  expect(fn).toHaveBeenCalledTimes(2)
})

test('at most two shows are fetched at a time; the third waits for one of them', async () => {
  const gates = { 1: deferred(), 2: deferred(), 3: deferred() }
  const fn = stub(url => { const id = Number(/series\/(\d+)\//.exec(url)[1]); return gates[id].promise.then(() => reply([episode(1, 1, `Show ${id}`)])) })
  const { result } = renderHook(() => useSeriesEpisodes([need(1, 1, 1), need(2, 1, 1), need(3, 1, 1)], { now: 1 }))
  await waitFor(() => expect(fn).toHaveBeenCalledTimes(2))
  await act(async () => { await new Promise(done => setTimeout(done, 20)) })
  expect(fn).toHaveBeenCalledTimes(2)
  await act(async () => { gates[1].resolve() })
  await waitFor(() => expect(fn).toHaveBeenCalledTimes(3))
  await act(async () => { gates[2].resolve(); gates[3].resolve() })
  await waitFor(() => expect(result.current.size).toBe(3))
  expect(result.current.get(3)).toEqual([{ seasonNumber: 1, episodeNumber: 1, title: 'Show 3' }])
})

test('nothing is fetched while Sonarr is not set up, or for a row without a show, season and number', async () => {
  const fn = stub(() => reply([]))
  const { rerender } = renderHook(({ enabled, needs }) => useSeriesEpisodes(needs, { enabled, now: 1 }),
    { initialProps: { enabled: false, needs: [need(4, 2, 6)] } })
  await act(async () => { await new Promise(done => setTimeout(done, 20)) })
  expect(fn).not.toHaveBeenCalled()
  rerender({ enabled: true, needs: [{ seriesId: null, season: 2, number: 6 }, { seriesId: 4, season: null, number: 6 }, need(0, 1, 1), need('4', 1, 1)] })
  await act(async () => { await new Promise(done => setTimeout(done, 20)) })
  expect(fn).not.toHaveBeenCalled()
  rerender({ enabled: true, needs: [need(4, 2, 6)] })
  await waitFor(() => expect(fn).toHaveBeenCalledTimes(1))
})

test('a list that could not be read is tried again after two minutes, not before', async () => {
  fakeDate()
  let healthy = false
  const fn = stub(() => (healthy ? reply([episode(2, 6, 'The Sixth')]) : reply({ error: 'Sonarr is down' }, false)))
  const needs = [need(4, 2, 6)]
  const { result, rerender } = renderHook(({ now }) => useSeriesEpisodes(needs, { now }), { initialProps: { now: 1 } })
  await waitFor(() => expect(fn).toHaveBeenCalledTimes(1))
  await act(async () => { await new Promise(done => setTimeout(done, 20)) })
  expect(result.current.size).toBe(0)
  vi.setSystemTime(T0 + 90 * 1000)
  rerender({ now: 2 })
  await act(async () => { await new Promise(done => setTimeout(done, 20)) })
  expect(fn).toHaveBeenCalledTimes(1)
  healthy = true
  vi.setSystemTime(T0 + 121 * 1000)
  rerender({ now: 3 })
  await waitFor(() => expect(result.current.get(4)).toEqual([{ seasonNumber: 2, episodeNumber: 6, title: 'The Sixth' }]))
  expect(fn).toHaveBeenCalledTimes(2)
})

test('a list that lacks an episode a row names is read again after ten minutes, and a complete one is not', async () => {
  fakeDate()
  let announced = false
  const fn = stub(url => reply(url.includes('/series/4/')
    ? [episode(2, 6, 'The Sixth'), ...(announced ? [episode(3, 1, 'Premiere')] : [])]
    : [episode(1, 1, 'Pilot')]))
  const { result, rerender } = renderHook(({ needs, now }) => useSeriesEpisodes(needs, { now }),
    { initialProps: { needs: [need(4, 2, 6), need(9, 1, 1)], now: 1 } })
  await waitFor(() => expect(result.current.size).toBe(2))
  expect(fn).toHaveBeenCalledTimes(2)
  // A new row names an episode the list did not have when it was read.
  rerender({ needs: [need(4, 3, 1), need(4, 2, 6), need(9, 1, 1)], now: 1 })
  await act(async () => { await new Promise(done => setTimeout(done, 20)) })
  expect(fn).toHaveBeenCalledTimes(2)
  announced = true
  vi.setSystemTime(T0 + 9 * 60 * 1000)
  rerender({ needs: [need(4, 3, 1), need(4, 2, 6), need(9, 1, 1)], now: 2 })
  await act(async () => { await new Promise(done => setTimeout(done, 20)) })
  expect(fn).toHaveBeenCalledTimes(2)
  vi.setSystemTime(T0 + 11 * 60 * 1000)
  rerender({ needs: [need(4, 3, 1), need(4, 2, 6), need(9, 1, 1)], now: 3 })
  await waitFor(() => expect(result.current.get(4)).toContainEqual({ seasonNumber: 3, episodeNumber: 1, title: 'Premiere' }))
  expect(urlsOf(fn).filter(url => url.includes('/series/4/'))).toHaveLength(2)
  expect(urlsOf(fn).filter(url => url.includes('/series/9/'))).toHaveLength(1)
})
