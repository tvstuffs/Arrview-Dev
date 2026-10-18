import React from 'react'
import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act, renderHook } from '@testing-library/react'
import { LibraryProvider } from '../../src/components/modern/LibraryProvider.jsx'
import { DownloadsProvider, useDownloads, useDownloadNeeds, useDownloadHistory } from '../../src/hooks/useDownloads.jsx'
import { reply } from './modern-helpers'

const CONFIG = { sabnzbd: { url: 'http://sab.invalid', apikey: 'k' }, sonarr: { url: 'http://sonarr.invalid', apikey: 'k' }, radarr: { url: 'http://radarr.invalid', apikey: 'k' } }
const slot = (id, extra = {}) => ({ nzo_id: id, filename: `Release.${id}`, status: 'Downloading', percentage: '40', mb: '1000', mbleft: '600', cat: 'tv', ...extra })
const sonarrRecord = (downloadId, seriesId, extra = {}) => ({ id: 1, downloadId, seriesId, episodeId: seriesId * 10, series: { id: seriesId, title: `Show ${seriesId}` }, episode: { id: seriesId * 10, seasonNumber: 1, episodeNumber: 1, title: 'E' }, ...extra })
const radarrRecord = (downloadId, movieId) => ({ id: 2, downloadId, movieId, movie: { id: movieId, title: `Film ${movieId}`, year: 2023 } })

const DOWNLOADS = { sab: true, page: true, sonarr: 'always', radarr: 'always' }
let hidden = false

// A test with several scenarios must not leave the earlier trees polling the newer fetch stub.
const mounted = []
const unmountAll = () => { while (mounted.length) mounted.pop()() }
function makeWorld(overrides = {}) {
  unmountAll()
  const world = { slots: [slot('n1')], status: 'Downloading', sonarr: [], radarr: [], fail: {}, capabilities: ['sonarrQueue', 'radarrQueue'], identify: 'ok', gate: {}, history: [], calls: [], ...overrides }
  vi.stubGlobal('fetch', vi.fn(async url => {
    url = String(url)
    world.calls.push(url)
    if (url.startsWith('/api/arrview/identify')) {
      if (world.gate.identify) await world.gate.identify
      return world.identify === 'fail' ? reply({ error: 'down' }, false) : reply({ capabilities: world.capabilities })
    }
    if (url.startsWith('/api/sabnzbd/queue')) {
      const answer = world.fail.sab ? reply({ error: 'SAB down' }, false) : reply({ queue: { status: world.status, kbpersec: '48230', timeleft: '0:10:00', slots: world.slots } })
      if (world.gate.sab) await world.gate.sab
      return answer
    }
    if (url.startsWith('/api/sabnzbd/history')) {
      if (world.onHistory) { const body = await world.onHistory(url); if (body) return reply(body) }
      return reply({ history: { slots: world.history, noofslots: world.history.length } })
    }
    for (const service of ['sonarr', 'radarr']) {
      if (url.startsWith(`/api/${service}/queue`)) {
        if (world.gate[service]) await world.gate[service]
        return world.fail[service] ? reply({ error: `${service} down` }, false) : reply({ records: world[service] })
      }
    }
    return reply([])
  }))
  world.count = prefix => world.calls.filter(url => url.startsWith(prefix)).length
  world.sab = () => world.count('/api/sabnzbd/queue')
  world.sonarrCount = () => world.count('/api/sonarr/queue')
  world.radarrCount = () => world.count('/api/radarr/queue')
  return world
}

function Need({ spec }) { useDownloadNeeds(spec); return null }
function Probe({ latest }) { latest.current = useDownloads(); return null }
function mount(specs, config = CONFIG) {
  const latest = { current: null }
  const tree = next => <LibraryProvider><DownloadsProvider config={config}>{next.map((spec, i) => <Need key={i} spec={spec} />)}<Probe latest={latest} /></DownloadsProvider></LibraryProvider>
  const view = render(tree(specs))
  mounted.push(view.unmount)
  return { latest, rerender: next => view.rerender(tree(next)), unmount: view.unmount }
}
const advance = ms => act(async () => { await vi.advanceTimersByTimeAsync(ms) })
const settle = async () => { for (let i = 0; i < 4; i++) await advance(1) }
// The counts of a 30 s window that starts once the first requests have settled.
async function windowOf(world, run = () => advance(30000)) {
  const before = { sab: world.sab(), sonarr: world.sonarrCount(), radarr: world.radarrCount() }
  await run()
  return { sab: world.sab() - before.sab, sonarr: world.sonarrCount() - before.sonarr, radarr: world.radarrCount() - before.radarr }
}
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }

beforeEach(() => {
  hidden = false
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
  vi.useFakeTimers()
})
afterEach(() => { unmountAll(); vi.useRealTimers(); vi.unstubAllGlobals() })

test('inert default outside a provider (criterion 13)', () => {
  const { result } = renderHook(() => useDownloads())
  expect(result.current).toMatchObject({ ready: true, slots: [], items: [], active: null, pill: null, error: null, arr: { sonarr: 'off', radarr: 'off' } })
  expect(result.current.byEpisode(1)).toBeNull()
  expect(result.current.byMovie(1)).toBeNull()
  renderHook(() => useDownloadNeeds({ sab: true }))
})

test('gating: with no consumer nothing is requested; an empty queue never asks the arr queues (criterion 9)', async () => {
  let world = makeWorld()
  mount([])
  await settle()
  expect(world.sab() + world.sonarrCount() + world.radarrCount()).toBe(0)
  await advance(30000)
  expect(world.sab() + world.sonarrCount() + world.radarrCount()).toBe(0)

  world = makeWorld({ slots: [] })
  mount([DOWNLOADS])
  await settle(); await advance(30000)
  expect(world.sab()).toBeGreaterThan(0)
  expect(world.sonarrCount() + world.radarrCount()).toBe(0)
})
test('gating: slots plus the Downloads spec request both queues; a series need requests only Sonarr; the pill alone requests neither (criterion 9, 10)', async () => {
  let world = makeWorld()
  mount([DOWNLOADS])
  await settle()
  expect([world.sonarrCount() > 0, world.radarrCount() > 0]).toEqual([true, true])

  world = makeWorld()
  mount([{ sab: true, sonarr: { seriesId: 1 } }])
  await settle(); await advance(30000)
  expect(world.sonarrCount()).toBeGreaterThan(0)
  expect(world.radarrCount()).toBe(0)

  world = makeWorld()
  mount([{ sab: true }])
  await settle(); await advance(30000)
  expect(world.sab()).toBeGreaterThan(0)
  expect(world.sonarrCount() + world.radarrCount()).toBe(0)
})
test('gating: no capability, a failed identify or an unconfigured service never requests the queue and shows no error (criterion 9)', async () => {
  let world = makeWorld({ capabilities: ['movieDelete'] })
  let view = mount([DOWNLOADS])
  await settle(); await advance(30000)
  expect(world.sonarrCount() + world.radarrCount()).toBe(0)
  expect(view.latest.current).toMatchObject({ ready: true, error: null, arr: { sonarr: 'off', radarr: 'off' } })

  world = makeWorld({ identify: 'fail' })
  view = mount([DOWNLOADS])
  await settle(); await advance(30000)
  expect(world.sonarrCount() + world.radarrCount()).toBe(0)
  expect(view.latest.current).toMatchObject({ ready: true, error: null })

  world = makeWorld()
  view = mount([DOWNLOADS], { sabnzbd: CONFIG.sabnzbd, sonarr: CONFIG.sonarr })
  await settle(); await advance(30000)
  expect(world.radarrCount()).toBe(0)
  expect(world.sonarrCount()).toBeGreaterThan(0)
  expect(view.latest.current.arr.radarr).toBe('off')
})
test('ready waits for identify and the answers the Downloads page needs, and never goes back (criterion 9)', async () => {
  const identify = deferred(), sonarr = deferred(), radarr = deferred()
  const world = makeWorld({ gate: { identify: identify.promise, sonarr: sonarr.promise, radarr: radarr.promise } })
  const { latest } = mount([DOWNLOADS])
  await settle()
  expect(latest.current.ready).toBe(false)
  expect(world.sab()).toBeGreaterThan(0)
  await act(async () => { identify.resolve(); await vi.advanceTimersByTimeAsync(1) }); await settle()
  expect(latest.current.ready).toBe(false)
  expect(latest.current.arr).toEqual({ sonarr: 'pending', radarr: 'pending' })
  await act(async () => { sonarr.resolve(); await vi.advanceTimersByTimeAsync(1) }); await settle()
  expect(latest.current.ready).toBe(false)
  await act(async () => { radarr.resolve(); await vi.advanceTimersByTimeAsync(1) }); await settle()
  expect(latest.current.ready).toBe(true)
  world.slots = [slot('n1'), slot('n2')]
  await advance(10000); await settle()
  expect(latest.current.ready).toBe(true)
})

test('SABnzbd cadence: 2 s with a page need while downloading, 10 s otherwise, none without a need (criterion 10)', async () => {
  let world = makeWorld()
  mount([DOWNLOADS])
  await settle()
  let counts = await windowOf(world)
  expect(counts.sab).toBeGreaterThanOrEqual(14)
  expect(counts.sab).toBeLessThanOrEqual(16)

  world = makeWorld()
  mount([{ sab: true }])
  await settle()
  counts = await windowOf(world)
  expect(counts.sab).toBeGreaterThanOrEqual(2)
  expect(counts.sab).toBeLessThanOrEqual(4)

  world = makeWorld({ status: 'Paused', slots: [slot('n1', { status: 'Paused' })] })
  mount([DOWNLOADS])
  await settle()
  counts = await windowOf(world)
  expect(counts.sab).toBeGreaterThanOrEqual(2)
  expect(counts.sab).toBeLessThanOrEqual(4)

  world = makeWorld()
  mount([])
  expect(world.sab()).toBe(0)
  counts = await windowOf(world)
  expect(counts.sab).toBe(0)
})
test('SABnzbd polling stops when the last need leaves and starts at once when one registers (criterion 10)', async () => {
  const world = makeWorld()
  const view = mount([{ sab: true }])
  await settle()
  view.rerender([])
  await settle()
  const stopped = await windowOf(world)
  expect(stopped.sab).toBe(0)
  const before = world.sab()
  view.rerender([{ sab: true }])
  await settle()
  expect(world.sab()).toBe(before + 1)
})
test('a hidden document stops polling and a visible one catches up once (criterion 10)', async () => {
  const world = makeWorld()
  mount([{ sab: true }])
  await settle()
  hidden = true
  const quiet = await windowOf(world)
  expect(quiet.sab).toBe(0)
  const before = world.sab()
  hidden = false
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await vi.advanceTimersByTimeAsync(1) })
  expect(world.sab()).toBe(before + 1)
})

test('arr cadence: the Downloads need polls each service every 10 s; two consumers of one service do not double it (criterion 10)', async () => {
  let world = makeWorld()
  mount([DOWNLOADS])
  await settle()
  let counts = await windowOf(world)
  expect(counts.sonarr).toBeGreaterThanOrEqual(2)
  expect(counts.sonarr).toBeLessThanOrEqual(4)
  expect(counts.radarr).toBeGreaterThanOrEqual(2)
  expect(counts.radarr).toBeLessThanOrEqual(4)

  world = makeWorld({ sonarr: [sonarrRecord('n1', 5)] })
  mount([{ sab: true, sonarr: { seriesId: 5 } }, { sab: true, sonarr: 'any' }])
  await settle()
  counts = await windowOf(world)
  expect(counts.sonarr).toBeGreaterThanOrEqual(2)
  expect(counts.sonarr).toBeLessThanOrEqual(4)
})
test('show page: unrelated slots cost one discovery request, a new id one more, a record for the show starts an interval that stops when the slot goes (criterion 10)', async () => {
  const world = makeWorld({ slots: [slot('n1')], status: 'Paused', sonarr: [sonarrRecord('n1', 2)] })
  mount([{ sab: true, sonarr: { seriesId: 1 } }])
  await settle()
  expect(world.sonarrCount()).toBe(1)
  let counts = await windowOf(world)
  expect(counts.sonarr).toBe(0)
  expect(world.radarrCount()).toBe(0)

  world.slots = [slot('n1'), slot('n2')]
  await advance(10000); await settle()
  expect(world.sonarrCount()).toBe(2)
  counts = await windowOf(world)
  expect(counts.sonarr).toBe(0)

  world.slots = [slot('n1'), slot('n2'), slot('n3')]
  world.sonarr = [sonarrRecord('n1', 2), sonarrRecord('n3', 1)]
  await advance(10000); await settle()
  counts = await windowOf(world)
  expect(counts.sonarr).toBeGreaterThanOrEqual(2)
  expect(counts.sonarr).toBeLessThanOrEqual(4)

  world.slots = [slot('n1')]
  await advance(10000); await settle()
  counts = await windowOf(world)
  expect(counts.sonarr).toBe(0)
})
test('movies: an unrelated queue costs one discovery request and no interval, and never touches Sonarr (criterion 10)', async () => {
  for (const scope of ['any', { movieId: 9 }]) {
    const world = makeWorld({ sonarr: [sonarrRecord('n1', 1)], radarr: [] })
    mount([{ sab: true, radarr: scope }])
    await settle()
    expect(world.radarrCount()).toBe(1)
    const counts = await windowOf(world)
    expect(counts.radarr).toBe(0)
    expect(world.sonarrCount()).toBe(0)
  }
})
test('a new id sends one request per needing service and a second one waits for the first to finish (criterion 10)', async () => {
  let gate = deferred()
  const world = makeWorld({ status: 'Paused', slots: [slot('n1', { status: 'Paused' })], gate: { sonarr: gate.promise } })
  mount([{ sab: true, sonarr: 'any', radarr: 'any' }])
  await settle()
  expect([world.sonarrCount(), world.radarrCount()]).toEqual([1, 1])
  world.slots = [slot('n1', { status: 'Paused' }), slot('n2', { status: 'Paused' })]
  await advance(10000)
  expect([world.sonarrCount(), world.radarrCount()]).toEqual([1, 2])
  gate.resolve(); gate = null
  await settle()
  expect(world.sonarrCount()).toBe(2)
})
test('a SABnzbd answer that lands while the document is hidden starts no arr request until it is visible again, then exactly one each (criterion 10)', async () => {
  const gate = deferred()
  const world = makeWorld({ status: 'Paused', slots: [slot('n1', { status: 'Paused' })], gate: { sab: gate.promise } })
  mount([DOWNLOADS])
  await settle()
  expect(world.sab()).toBe(1)
  hidden = true
  await act(async () => { gate.resolve(); await vi.advanceTimersByTimeAsync(1) }); await settle()
  expect(world.sonarrCount() + world.radarrCount()).toBe(0)
  await advance(30000)
  expect(world.sonarrCount() + world.radarrCount()).toBe(0)
  hidden = false
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await vi.advanceTimersByTimeAsync(1) }); await settle()
  expect([world.sonarrCount(), world.radarrCount()]).toEqual([1, 1])
})
test('a deferred discovery rerun is dropped when the last consumer leaves or the queue empties before the earlier request resolves (criterion 10)', async () => {
  for (const change of ['consumer', 'queue']) {
    const gate = deferred()
    const world = makeWorld({ status: 'Paused', slots: [slot('n1', { status: 'Paused' })], gate: { sonarr: gate.promise } })
    const view = mount([{ sab: true, sonarr: 'any' }])
    await settle()
    expect(world.sonarrCount()).toBe(1)
    world.slots = [slot('n1', { status: 'Paused' }), slot('n2', { status: 'Paused' })]
    await advance(10000)
    expect(world.sonarrCount()).toBe(1)
    if (change === 'consumer') { view.rerender([]); await settle() } else { world.slots = []; await advance(10000) }
    await act(async () => { gate.resolve(); await vi.advanceTimersByTimeAsync(1) }); await settle()
    expect(world.sonarrCount()).toBe(1)
    await advance(30000)
    expect(world.sonarrCount()).toBe(1)
  }
})
test('an arr error keeps a 10 s retry while a need is registered and clears it on success (criterion 10, 12)', async () => {
  const world = makeWorld({ status: 'Paused', slots: [slot('n1', { status: 'Paused' })], sonarr: [sonarrRecord('n1', 2)], fail: { sonarr: true } })
  const { latest } = mount([{ sab: true, sonarr: { seriesId: 1 } }])
  await settle()
  expect(latest.current.arr.sonarr).toBe('error')
  let counts = await windowOf(world)
  expect(counts.sonarr).toBeGreaterThanOrEqual(2)
  world.fail.sonarr = false
  await advance(10000); await settle()
  expect(latest.current.arr.sonarr).toBe('ok')
  counts = await windowOf(world)
  expect(counts.sonarr).toBe(0)
})

test('failures: no data shows the error, earlier data survives, an arr failure keeps matches and recovery clears it (criterion 12)', async () => {
  let world = makeWorld({ fail: { sab: true } })
  let { latest } = mount([DOWNLOADS])
  await settle()
  expect(latest.current).toMatchObject({ ready: true, error: 'SAB down', queue: null })

  world = makeWorld({ sonarr: [sonarrRecord('n1', 3)] })
  ;({ latest } = mount([DOWNLOADS]))
  await settle()
  expect(latest.current.items[0]).toMatchObject({ matched: true, title: 'Show 3' })
  expect(latest.current.byEpisode(30)).toBe(latest.current.items[0])
  world.fail.sab = true
  await advance(2000); await settle()
  expect(latest.current.error).toBeNull()
  expect(latest.current.slots).toHaveLength(1)
  world.fail.sab = false
  world.fail.sonarr = true
  await advance(10000); await settle()
  expect(latest.current.arr.sonarr).toBe('error')
  expect(latest.current.items[0].matched).toBe(true)
  expect(latest.current.items[0].hint).toBeNull()
  world.fail.sonarr = false
  await advance(10000); await settle()
  expect(latest.current.arr.sonarr).toBe('ok')
})
test('items, the lead item, the pill item and the movie map come from the shared state', async () => {
  makeWorld({ slots: [slot('n1', { status: 'Paused' }), slot('n2', { cat: 'movies' })], radarr: [radarrRecord('n2', 9)] })
  const { latest } = mount([DOWNLOADS])
  await settle()
  expect(latest.current.active.key).toBe('n2')
  expect(latest.current.pill.key).toBe('n2')
  expect(latest.current.byMovie(9)).toBe(latest.current.items[1])
  expect(latest.current.speed).toBe('48230')
})

test('history is not refetched on every queue poll: every 10 s, on a limit change, and once when a slot id leaves (criterion 11)', async () => {
  const world = makeWorld()
  const slots = { current: [slot('a'), slot('b')] }
  const { rerender } = renderHook(({ limit }) => useDownloadHistory({ slots: slots.current, limit }), { initialProps: { limit: 15 } })
  await settle()
  const history = () => world.count('/api/sabnzbd/history')
  expect(history()).toBe(1)
  await advance(30000)
  expect(history()).toBe(4)
  rerender({ limit: 30 })
  await settle()
  expect(history()).toBe(5)
  expect(world.calls.filter(url => url.includes('limit=30'))).toHaveLength(1)
  slots.current = [slot('a')]
  rerender({ limit: 30 })
  await settle()
  expect(history()).toBe(6)
})
function pendingHistory(world) {
  const pending = []
  world.onHistory = url => { const entry = { url, ...deferred() }; pending.push(entry); return entry.promise }
  return pending
}
const historyBody = (...ids) => ({ history: { slots: ids.map(id => ({ nzo_id: id, name: id, status: 'Completed' })), noofslots: ids.length } })
test('history: an interval tick and a slot disappearing while a request is pending never overlap; one rerun follows (criterion 11)', async () => {
  const world = makeWorld()
  const pending = pendingHistory(world)
  const slots = { current: [slot('a'), slot('b')] }
  const { result, rerender } = renderHook(({ limit }) => useDownloadHistory({ slots: slots.current, limit }), { initialProps: { limit: 15 } })
  await settle()
  expect(pending).toHaveLength(1)
  await advance(10000)
  slots.current = [slot('a')]
  rerender({ limit: 15 })
  await settle()
  expect(pending).toHaveLength(1)
  await act(async () => { pending[0].resolve(historyBody('old')); await vi.advanceTimersByTimeAsync(1) }); await settle()
  expect(pending).toHaveLength(2)
  expect(result.current.slots.map(item => item.nzo_id)).toEqual(['old'])
  await act(async () => { pending[1].resolve(historyBody('new')); await vi.advanceTimersByTimeAsync(1) }); await settle()
  expect(pending).toHaveLength(2)
  expect(result.current.slots.map(item => item.nzo_id)).toEqual(['new'])
})
test('history: a delayed response for the old limit is dropped and cannot overwrite the new limit (criterion 11)', async () => {
  const world = makeWorld()
  const pending = pendingHistory(world)
  const { result, rerender } = renderHook(({ limit }) => useDownloadHistory({ slots: [], limit }), { initialProps: { limit: 15 } })
  await settle()
  expect(pending.map(entry => entry.url)).toEqual(['/api/sabnzbd/history?limit=15'])
  rerender({ limit: 30 })
  await settle()
  expect(pending).toHaveLength(1)
  await act(async () => { pending[0].resolve(historyBody('fifteen')); await vi.advanceTimersByTimeAsync(1) }); await settle()
  expect(result.current.slots).toBeNull()
  expect(pending.map(entry => entry.url)).toEqual(['/api/sabnzbd/history?limit=15', '/api/sabnzbd/history?limit=30'])
  await act(async () => { pending[1].resolve(historyBody('thirty', 'thirty-b')); await vi.advanceTimersByTimeAsync(1) }); await settle()
  expect(result.current.slots.map(item => item.nzo_id)).toEqual(['thirty', 'thirty-b'])
  expect(pending).toHaveLength(2)
})
test('history: unmounting the hook before its pending request resolves starts no queued rerun', async () => {
  const world = makeWorld()
  const pending = pendingHistory(world)
  const { unmount, rerender } = renderHook(({ limit }) => useDownloadHistory({ slots: [], limit }), { initialProps: { limit: 15 } })
  await settle()
  rerender({ limit: 30 })
  await settle()
  expect(pending).toHaveLength(1)
  unmount()
  await act(async () => { pending[0].resolve(historyBody('late')); await vi.advanceTimersByTimeAsync(1) }); await settle()
  await advance(30000)
  expect(pending).toHaveLength(1)
})
test('history: a slot leaving while the document is hidden starts no request until it is visible again, then exactly one (deferred SABnzbd response)', async () => {
  const world = makeWorld({ status: 'Paused', slots: [slot('n1', { status: 'Paused' }), slot('n2', { status: 'Paused' })] })
  const out = { current: null }
  function HistoryProbe() { out.current = useDownloadHistory({ slots: useDownloads().slots, limit: 15, enabled: true }); return null }
  const view = render(<LibraryProvider><DownloadsProvider config={CONFIG}><Need spec={{ sab: true, page: true }} /><HistoryProbe /></DownloadsProvider></LibraryProvider>)
  mounted.push(view.unmount)
  await settle()
  const history = () => world.count('/api/sabnzbd/history')
  const gate = deferred()
  world.gate.sab = gate.promise
  world.slots = [slot('n1', { status: 'Paused' })]
  await advance(10000); await settle()
  const before = history()
  hidden = true
  await act(async () => { gate.resolve(); await vi.advanceTimersByTimeAsync(1) }); await settle()
  await advance(30000)
  expect(history()).toBe(before)
  hidden = false
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await vi.advanceTimersByTimeAsync(1) }); await settle()
  expect(history()).toBe(before + 1)
})
test('an arr request pending when the provider unmounts starts no queued rerun', async () => {
  const gate = deferred()
  const world = makeWorld({ status: 'Paused', slots: [slot('n1', { status: 'Paused' })], gate: { sonarr: gate.promise } })
  const view = mount([{ sab: true, sonarr: 'any' }])
  await settle()
  world.slots = [slot('n1', { status: 'Paused' }), slot('n2', { status: 'Paused' })]
  await advance(10000)
  expect(world.sonarrCount()).toBe(1)
  view.unmount()
  await act(async () => { gate.resolve(); await vi.advanceTimersByTimeAsync(1) }); await settle()
  await advance(30000)
  expect(world.sonarrCount()).toBe(1)
})

test('SABnzbd: an explicit refresh during a poll is coalesced into one rerun, and the older response cannot overwrite the newer', async () => {
  const gate = deferred()
  const world = makeWorld({ status: 'Paused', slots: [slot('n1', { status: 'Paused' })] })
  const { latest } = mount([{ sab: true }])
  await settle()
  const before = world.sab()
  world.gate.sab = gate.promise
  await advance(10000)
  expect(world.sab()).toBe(before + 1)
  world.slots = [slot('n1', { status: 'Paused' }), slot('n2', { status: 'Paused' })]
  await act(async () => { latest.current.refresh(); latest.current.refresh() })
  expect(world.sab()).toBe(before + 1)
  await act(async () => { gate.resolve(); await vi.advanceTimersByTimeAsync(1) }); await settle()
  expect(world.sab()).toBe(before + 2)
  expect(latest.current.slots.map(item => item.nzo_id)).toEqual(['n1', 'n2'])
})
test('SABnzbd: an action completing after the last consumer left, or while the document is hidden, requests nothing until visible', async () => {
  const world = makeWorld({ status: 'Paused', slots: [slot('n1', { status: 'Paused' })] })
  const { latest, rerender } = mount([{ sab: true }])
  await settle()
  const refresh = latest.current.refresh
  rerender([])
  await settle()
  const afterLeave = world.sab()
  await act(async () => { refresh(); await vi.advanceTimersByTimeAsync(1) }); await settle()
  expect(world.sab()).toBe(afterLeave)
  rerender([{ sab: true }])
  await settle()
  expect(world.sab()).toBe(afterLeave + 1)

  hidden = true
  const base = world.sab()
  await act(async () => { latest.current.refresh(); await vi.advanceTimersByTimeAsync(1) }); await settle()
  expect(world.sab()).toBe(base)
  hidden = false
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await vi.advanceTimersByTimeAsync(1) }); await settle()
  expect(world.sab()).toBe(base + 1)
})
test('SABnzbd: a cadence change during a request does not start a second concurrent request', async () => {
  const gate = deferred()
  const world = makeWorld({ slots: [slot('n1')] })
  const view = mount([{ sab: true }])
  await settle()
  const before = world.sab()
  world.gate.sab = gate.promise
  await advance(10000)
  expect(world.sab()).toBe(before + 1)
  view.rerender([{ sab: true, page: true }])
  await settle()
  expect(world.sab()).toBe(before + 1)
  await act(async () => { gate.resolve(); await vi.advanceTimersByTimeAsync(1) }); await settle()
  expect(world.sab()).toBe(before + 2)
})
