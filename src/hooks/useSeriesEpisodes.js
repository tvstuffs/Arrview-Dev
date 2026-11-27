import { useEffect, useRef, useState } from 'react'
import { apiFetch } from '../api'

// The episode lists of the few shows that Recent History names, so a row can read "S2 E6 · <episode title>".
//
// `needs` is [{ seriesId, season, number }] for the rows on screen. Each show's list is fetched once while a row needs it,
// at most two at a time, through the route the show pages use. A fetch that fails is tried again after two minutes,
// and a list that lacks an episode a row needs is fetched again after ten (a page left open while a new season is
// announced). Nothing is fetched while `enabled` is false. Only the season, the number and the title of each episode
// are kept. Returns a Map of a show's id to its list; a show whose list has not arrived is absent, and its rows keep
// "S2 E6".
const RETRY_MS = 2 * 60 * 1000
const STALE_MS = 10 * 60 * 1000
const AT_ONCE = 2

const keep = data => (Array.isArray(data) ? data : []).map(ep => ({
  seasonNumber: ep?.seasonNumber, episodeNumber: ep?.episodeNumber, title: typeof ep?.title === 'string' ? ep.title : '',
}))

export default function useSeriesEpisodes(needs, { enabled = true, now = 0 } = {}) {
  const [lists, setLists] = useState(() => new Map())
  const listsRef = useRef(lists)
  listsRef.current = lists
  const status = useRef(new Map()) // id -> { at, ok, pending }
  const waiting = useRef([])
  const running = useRef(0)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])

  const key = enabled
    ? [...new Set((needs || []).filter(need => Number.isSafeInteger(need?.seriesId) && need.seriesId > 0
      && Number.isSafeInteger(need.season) && Number.isSafeInteger(need.number))
      .map(need => `${need.seriesId}:${need.season}:${need.number}`))].sort().join(',')
    : ''

  useEffect(() => {
    if (!key) return
    const wanted = new Map()
    for (const part of key.split(',')) {
      const [id, season, number] = part.split(':').map(Number)
      if (!wanted.has(id)) wanted.set(id, [])
      wanted.get(id).push({ season, number })
    }
    const clock = Date.now()
    for (const [id, episodes] of wanted) {
      const known = status.current.get(id)
      if (known?.pending || waiting.current.includes(id)) continue
      if (known) {
        const age = clock - known.at
        if (!known.ok && age < RETRY_MS) continue
        if (known.ok) {
          const list = listsRef.current.get(id) || []
          const lacks = episodes.some(({ season, number }) => !list.some(ep => ep.seasonNumber === season && ep.episodeNumber === number))
          if (!lacks || age < STALE_MS) continue
        }
      }
      waiting.current.push(id)
    }
    pump()
  }, [key, now])

  function pump() {
    while (mounted.current && running.current < AT_ONCE && waiting.current.length) {
      const id = waiting.current.shift()
      running.current += 1
      status.current.set(id, { ...(status.current.get(id) || { at: 0, ok: false }), pending: true })
      load(id).finally(() => { running.current -= 1; pump() })
    }
  }

  async function load(id) {
    try {
      const response = await apiFetch(`/api/sonarr/series/${id}/episodes`)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const list = keep(await response.json())
      status.current.set(id, { at: Date.now(), ok: true, pending: false })
      if (mounted.current) setLists(previous => new Map(previous).set(id, list))
    } catch {
      status.current.set(id, { at: Date.now(), ok: false, pending: false })
    }
  }

  return lists
}
