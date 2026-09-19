import React from 'react'
import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, renderHook, fireEvent, screen, act } from '@testing-library/react'
import { usePreference, oneOf } from '../../src/hooks/usePreference'
import { ServerEventsProvider, useServerEvents, useVisiblePolling } from '../../src/hooks/lifecycle'
import ConfirmSheet from '../../src/components/ConfirmSheet'
import { useCommandPolling } from '../../src/hooks/useCommandPolling'
import { deleteAndUnmonitor } from '../../src/actions'

function visibility(hidden) {
  Object.defineProperty(document, 'hidden', { configurable: true, value: hidden })
  act(() => document.dispatchEvent(new Event('visibilitychange')))
}
beforeEach(() => { localStorage.clear(); visibility(false) })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
test('preferences validate, survive remount, and tolerate corrupt/blocked storage', () => {
  localStorage.setItem('arrview.ui.v1.test', '{bad')
  const first = renderHook(() => usePreference('test', 'all', oneOf(['all','missing'])))
  expect(first.result.current[0]).toBe('all')
  act(() => first.result.current[1]('missing'))
  first.unmount()
  const second = renderHook(() => usePreference('test', 'all', oneOf(['all','missing'])))
  expect(second.result.current[0]).toBe('missing')
  vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('blocked') })
  act(() => second.result.current[1]('all'))
  expect(second.result.current[0]).toBe('all')
})
test('hidden pages stop polling and visible pages refetch immediately; cleanup stops timers', async () => {
  vi.useFakeTimers()
  const load = vi.fn().mockResolvedValue()
  const hook = renderHook(() => useVisiblePolling(load, 10000))
  await act(async () => {})
  expect(load).toHaveBeenCalledTimes(1)
  await act(async () => vi.advanceTimersByTimeAsync(10000))
  expect(load).toHaveBeenCalledTimes(2)
  visibility(true)
  await act(async () => vi.advanceTimersByTimeAsync(60000))
  expect(load).toHaveBeenCalledTimes(2)
  visibility(false); await act(async () => {})
  expect(load).toHaveBeenCalledTimes(3)
  hook.unmount()
  expect(vi.getTimerCount()).toBe(0)
})
test('one SSE stream serves multiple subscribers, closes hidden, reconnects, and catches up after network recovery', () => {
  const streams = []
  class Source extends EventTarget { constructor() { super(); streams.push(this); this.close = vi.fn() } }
  vi.stubGlobal('EventSource', Source)
  const movie = vi.fn(), show = vi.fn()
  function Client() { useServerEvents('radarr', movie); useServerEvents('sonarr', show); return null }
  const view = render(<ServerEventsProvider><Client /></ServerEventsProvider>)
  expect(streams).toHaveLength(1)
  act(() => streams[0].dispatchEvent(new MessageEvent('radarr', { data: '{}' })))
  expect(movie).toHaveBeenCalledTimes(1); expect(show).not.toHaveBeenCalled()
  act(() => { streams[0].onopen(); streams[0].onopen() })
  expect(movie).toHaveBeenCalledTimes(2); expect(show).toHaveBeenCalledTimes(1)
  visibility(true); expect(streams[0].close).toHaveBeenCalledTimes(1)
  visibility(false); expect(streams).toHaveLength(2)
  view.unmount(); expect(streams[1].close).toHaveBeenCalledTimes(1)
})
test('confirmation cancel does nothing; failure stays in sheet with no success close', async () => {
  const close = vi.fn(), run = vi.fn().mockRejectedValue(new Error('Sonarr unavailable'))
  render(<ConfirmSheet title="Delete?" description="Files leave Sonarr" actions={[{ label: 'Delete and Unmonitor', run }]} onClose={close} />)
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(run).not.toHaveBeenCalled(); expect(close).toHaveBeenCalledTimes(1)
  close.mockClear()
  fireEvent.click(screen.getByRole('button', { name: 'Delete and Unmonitor' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Sonarr unavailable')
  expect(close).not.toHaveBeenCalled()
})
test('partial season failures only unmonitor successfully deleted files, then report failure', async () => {
  const fetch = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({}) })
    .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ error: 'failed' }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
  vi.stubGlobal('fetch', fetch)
  await expect(deleteAndUnmonitor([{ id: 1, episodeFileId: 10 }, { id: 2, episodeFileId: 20 }])).rejects.toThrow('1 of 2')
  expect(JSON.parse(fetch.mock.calls[2][1].body)).toEqual({ episodeIds: [1], monitored: false })
})
test('failed unmonitor after deleting files reports the partial consequence', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({}) })
    .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) }))
  await expect(deleteAndUnmonitor([{ id: 1, episodeFileId: 10 }])).rejects.toThrow('Files were deleted')
})

test('resuming during an in-flight poll schedules an immediate catch-up without overlap', async () => {
  let finish
  const load = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve })).mockResolvedValue()
  const hook = renderHook(() => useVisiblePolling(load, 60000))
  visibility(true); visibility(false)
  expect(load).toHaveBeenCalledTimes(1)
  await act(async () => { finish() })
  expect(load).toHaveBeenCalledTimes(2)
  hook.unmount()
})


test('command polling pauses hidden, resumes immediately and disposes on unmount', async () => {
  vi.useFakeTimers()
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'started' }) })
  vi.stubGlobal('fetch', fetch)
  const done = vi.fn()
  const hook = renderHook(() => useCommandPolling())
  act(() => hook.result.current(99, done))
  visibility(true)
  await act(async () => vi.advanceTimersByTimeAsync(12000))
  expect(fetch).not.toHaveBeenCalled()
  visibility(false); await act(async () => {})
  expect(fetch).toHaveBeenCalledTimes(1)
  hook.unmount()
  await act(async () => vi.advanceTimersByTimeAsync(10000))
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(done).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
})
