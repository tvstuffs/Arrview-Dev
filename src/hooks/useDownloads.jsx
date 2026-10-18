import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useVisiblePolling } from './lifecycle'
import { useIdentity } from '../components/modern/LibraryProvider.jsx'
import { buildQueueItems, leadItem, pillItem } from '../downloads'

// One shared store for every download surface in the Modern shell. Surfaces register what they need with
// useDownloadNeeds; nothing is polled unless a registered, visible surface needs it, and nothing is polled twice.
//
//   spec = { sab?: true, page?: true, sonarr?: scope, radarr?: scope }
//   scope = 'always' | 'any' | { seriesId } | { movieId }
const Store = createContext(null)
const CAPABILITY = { sonarr: 'sonarrQueue', radarr: 'radarrQueue' }
const NO_ARR = { records: [], answered: false, error: false }
const configured = service => Boolean(service?.url && service?.apikey)

// What useDownloads() returns outside a provider, so pages rendered on their own behave as before.
const INERT = {
  configured: { sab: false, sonarr: false, radarr: false }, ready: true, error: null, queue: null, slots: [], items: [], active: null, pill: null,
  speed: null, arr: { sonarr: 'off', radarr: 'off' }, byEpisode: () => null, byMovie: () => null, refresh: async () => {},
}

export function useDownloads() { return useContext(Store) || INERT }

export function useDownloadNeeds(spec) {
  const register = useContext(Store)?.register
  const key = JSON.stringify(spec)
  useEffect(() => (register ? register(JSON.parse(key)) : undefined), [register, key])
}

async function readQueue(url) {
  const response = await fetch(url)
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body?.error || `Request failed (${response.status})`)
  return body
}

// Sonarr / Radarr queue: a discovery fetch per change of the SABnzbd id set, an interval only while a registered
// need has a record to follow (or while recovering from an error). At most one request is in flight.
function useArrQueue(service, { on, needs, slots, slotKey, data, setData }) {
  const inflight = useRef(false)
  const rerun = useRef(false)
  const attempted = useRef(null)
  const latestKey = useRef(slotKey)
  latestKey.current = slotKey
  const run = useRef(null)
  run.current = async () => {
    inflight.current = true
    attempted.current = latestKey.current
    try {
      const body = await readQueue(`/api/${service}/queue`)
      if (!Array.isArray(body?.records)) throw new Error('Unexpected response')
      setData({ records: body.records, answered: true, error: false })
    } catch { setData(previous => ({ ...previous, error: true })) }
    finally {
      inflight.current = false
      if (rerun.current) { rerun.current = false; if (attempted.current !== latestKey.current) run.current() }
    }
  }
  const tick = useCallback(() => { if (!inflight.current) return run.current() }, [])
  const discover = useCallback(() => { if (inflight.current) { rerun.current = true; return } return run.current() }, [])

  const registered = needs.filter(entry => entry.spec[service] !== undefined)
  const wanted = on && registered.length > 0 && slots.length > 0
  const ids = new Set(slots.map(slot => slot.nzo_id))
  const followed = data.records.filter(record => typeof record?.downloadId === 'string' && ids.has(record.downloadId))
  const live = scope => {
    if (scope === 'always') return slots.length > 0
    if (scope === 'any') return followed.length > 0
    if (scope && 'seriesId' in scope) return followed.some(record => (record.seriesId ?? record.series?.id) === scope.seriesId)
    if (scope && 'movieId' in scope) return followed.some(record => (record.movieId ?? record.movie?.id) === scope.movieId)
    return false
  }
  const active = wanted && (data.error || registered.some(entry => live(entry.spec[service])))

  useEffect(() => {
    if (!slotKey) attempted.current = null
    if (!wanted || attempted.current === slotKey) return
    discover()
  }, [wanted, slotKey, discover])
  useVisiblePolling(tick, 10000, active)
  return { wanted }
}

export function DownloadsProvider({ config, children }) {
  const sabOn = configured(config?.sabnzbd)
  const { identity, settled } = useIdentity()
  const [needs, setNeeds] = useState([])
  const [sab, setSab] = useState({ queue: null, error: null, answered: false })
  const [sonarrData, setSonarrData] = useState(NO_ARR)
  const [radarrData, setRadarrData] = useState(NO_ARR)

  const register = useCallback(spec => {
    const entry = { spec }
    setNeeds(list => [...list, entry])
    return () => setNeeds(list => list.filter(item => item !== entry))
  }, [])

  const fetchSab = useCallback(async () => {
    try {
      const body = await readQueue('/api/sabnzbd/queue')
      if (!body?.queue) throw new Error('Unexpected response')
      setSab({ queue: body.queue, error: null, answered: true })
    } catch (e) { setSab(previous => ({ ...previous, error: e.message || 'Request failed', answered: true })) }
  }, [])
  const sabNeeded = sabOn && needs.some(entry => entry.spec.sab)
  const pageNeeded = needs.some(entry => entry.spec.page)
  const downloading = sab.queue?.status === 'Downloading'
  useVisiblePolling(fetchSab, pageNeeded && downloading ? 2000 : 10000, sabNeeded)

  const slots = useMemo(() => sab.queue?.slots || [], [sab.queue])
  const slotKey = useMemo(() => slots.map(slot => slot.nzo_id).sort().join('\n'), [slots])
  const capable = service => Array.isArray(identity?.capabilities) && identity.capabilities.includes(CAPABILITY[service])
  const available = service => configured(config?.[service])
  const on = service => available(service) && settled && capable(service)
  const sonarr = useArrQueue('sonarr', { on: on('sonarr'), needs, slots, slotKey, data: sonarrData, setData: setSonarrData })
  const radarr = useArrQueue('radarr', { on: on('radarr'), needs, slots, slotKey, data: radarrData, setData: setRadarrData })

  const stateOf = (service, wanted, data) => !available(service) || (settled && !capable(service)) ? 'off'
    : !settled || !wanted ? 'idle' : data.error ? 'error' : data.answered ? 'ok' : 'pending'
  const arr = { sonarr: stateOf('sonarr', sonarr.wanted, sonarrData), radarr: stateOf('radarr', radarr.wanted, radarrData) }

  const items = useMemo(() => buildQueueItems(slots, {
    sonarr: { state: arr.sonarr, records: sonarrData.records, kept: sonarrData.error && sonarrData.answered },
    radarr: { state: arr.radarr, records: radarrData.records, kept: radarrData.error && radarrData.answered },
  }), [slots, arr.sonarr, arr.radarr, sonarrData, radarrData])
  const { byEpisodeMap, byMovieMap } = useMemo(() => {
    const byEpisodeMap = new Map(), byMovieMap = new Map()
    for (const item of items) {
      if (item.kind === 'tv') item.episodeIds.forEach(id => byEpisodeMap.set(id, item))
      else if (item.kind === 'movie' && item.mediaId != null) byMovieMap.set(item.mediaId, item)
    }
    return { byEpisodeMap, byMovieMap }
  }, [items])

  const arrConfigured = available('sonarr') || available('radarr')
  const blocked = ['sonarr', 'radarr'].some(service => arr[service] === 'pending' && needs.some(entry => entry.spec[service] === 'always'))
  const readyNow = (!sabOn || sab.answered) && (!arrConfigured || settled) && !blocked
  const latched = useRef(false)
  if (readyNow) latched.current = true

  const value = useMemo(() => ({
    register, configured: { sab: sabOn, sonarr: available('sonarr'), radarr: available('radarr') }, ready: latched.current,
    error: sab.queue ? null : sab.error, queue: sab.queue, slots, items, active: leadItem(items), pill: pillItem(items),
    speed: sab.queue?.kbpersec ?? null, arr, byEpisode: id => byEpisodeMap.get(id) || null, byMovie: id => byMovieMap.get(id) || null, refresh: fetchSab,
  }), [register, sabOn, sab, slots, items, arr.sonarr, arr.radarr, byEpisodeMap, byMovieMap, fetchSab, readyNow, config?.sonarr, config?.radarr])
  return <Store.Provider value={value}>{children}</Store.Provider>
}

// Recent History for the Downloads page: on mount, when the limit changes, every 10 s, and once when a slot id leaves the queue.
export function useDownloadHistory({ slots, limit, enabled = true }) {
  const [state, setState] = useState({ slots: null, total: null, error: null })
  const fetchHistory = useCallback(async () => {
    try {
      const body = await readQueue(`/api/sabnzbd/history?limit=${limit}`)
      const history = body?.history
      setState({ slots: history?.slots || [], total: Number.isFinite(Number(history?.noofslots)) ? Number(history.noofslots) : null, error: null })
    } catch (e) { setState(previous => ({ ...previous, error: e.message || 'Request failed' })) }
  }, [limit])
  useVisiblePolling(fetchHistory, 10000, enabled, limit)
  const key = slots.map(slot => slot.nzo_id).sort().join('\n')
  const previous = useRef(null)
  useEffect(() => {
    const before = previous.current
    const now = new Set(key ? key.split('\n') : [])
    previous.current = now
    if (enabled && before && [...before].some(id => !now.has(id))) fetchHistory()
  }, [key, enabled, fetchHistory])
  return { ...state, refresh: fetchHistory }
}

// The current time, refreshed while the page is visible. Components read it so tests can pin the clock.
export function useNow(intervalMs = 30000) {
  const [now, setNow] = useState(() => Date.now())
  useVisiblePolling(() => setNow(Date.now()), intervalMs)
  return now
}
