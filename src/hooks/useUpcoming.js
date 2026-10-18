import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { checkedFetch } from '../actions'
import { useVisiblePolling, useServerEvents } from './lifecycle'
import { calendarRange, radarrWindow, collapse, movieEntries, sortEntries } from '../upcoming'

const EMPTY = { data: null, now: 0, error: null, answered: false }
const configured = service => Boolean(service?.url && service?.apikey)

// One data source for every Upcoming surface: Sonarr episodes (collapsed) plus Radarr releases when the
// server advertises `radarrCalendar`. Returns { entries, loading, errors, retry, sources } (D1, D3).
export default function useUpcoming(config) {
  const sonarrOn = configured(config?.sonarr)
  const radarrOn = configured(config?.radarr)
  const [capable, setCapable] = useState(null)
  const [sonarr, setSonarr] = useState(EMPTY)
  const [radarr, setRadarr] = useState(EMPTY)
  const settled = useRef(false)

  useEffect(() => {
    if (!radarrOn) return
    let disposed = false
    checkedFetch('/api/arrview/identify')
      .then(identity => { if (!disposed) setCapable(Array.isArray(identity?.capabilities) && identity.capabilities.includes('radarrCalendar')) })
      .catch(() => { if (!disposed) setCapable(false) })
    return () => { disposed = true }
  }, [radarrOn])

  const load = useCallback(async (service, url, setState) => {
    const now = Date.now()
    try {
      const body = await checkedFetch(url(now))
      if (!Array.isArray(body)) throw new Error('Unexpected response')
      setState({ data: body, now, error: null, answered: true })
    } catch {
      setState(previous => ({ ...previous, error: `Cannot reach ${service}`, answered: true }))
    }
  }, [])
  const refreshSonarr = useCallback(() => load('Sonarr',
    now => `/api/sonarr/calendar?${new URLSearchParams(calendarRange(new Date(now)))}`, setSonarr), [load])
  const refreshRadarr = useCallback(() => load('Radarr', now => {
    const { start, end } = radarrWindow(new Date(now))
    return `/api/radarr/calendar?${new URLSearchParams({ start, end })}`
  }, setRadarr), [load])

  const radarrActive = radarrOn && capable === true
  useVisiblePolling(refreshSonarr, 60000, sonarrOn)
  useVisiblePolling(refreshRadarr, 60000, radarrActive)
  useServerEvents('sonarr', refreshSonarr, sonarrOn)
  useServerEvents('radarr', refreshRadarr, radarrActive)

  const pending = (radarrOn && capable === null) || (sonarrOn && !sonarr.answered) || (radarrActive && !radarr.answered)
  if (!pending) settled.current = true

  const entries = useMemo(() => {
    const list = []
    if (sonarr.data) list.push(...collapse(sonarr.data, sonarr.now))
    if (radarr.data) list.push(...movieEntries(radarr.data, radarrWindow(new Date(radarr.now)), radarr.now))
    return sortEntries(list)
  }, [sonarr, radarr])

  const retry = useCallback(service => (service === 'radarr' ? refreshRadarr() : refreshSonarr()), [refreshSonarr, refreshRadarr])
  return {
    entries, loading: !settled.current,
    errors: { sonarr: sonarr.error, radarr: radarr.error },
    retry, sources: { tv: sonarrOn, movies: radarrActive },
  }
}
