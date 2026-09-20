import { useState, useCallback } from 'react'
import { checkedFetch } from '../actions'
import { useVisiblePolling, useServerEvents } from '../hooks/lifecycle'
import { Poster } from './MediaControls'

export function calendarRange(now = new Date()) {
  const start = new Date(now), end = new Date(now)
  start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - 1)
  end.setHours(23, 59, 59, 999); end.setDate(end.getDate() + 14)
  return { start: start.toISOString(), end: end.toISOString() }
}
export function episodeStatus(episode, now = Date.now()) {
  return episode.hasFile ? 'Downloaded' : Date.parse(episode.airDateUtc) <= now ? 'Missing' : 'Upcoming'
}
export default function UpcomingTab({ onShow }) {
  const [episodes, setEpisodes] = useState(null)
  const [error, setError] = useState(null)
  const refresh = useCallback(async () => {
    try { setEpisodes(await checkedFetch(`/api/sonarr/calendar?${new URLSearchParams(calendarRange())}`)); setError(null) }
    catch (e) { setError(e.message) }
  }, [])
  useVisiblePolling(refresh, 60000)
  useServerEvents('sonarr', refresh)
  const groups = new Map()
  for (const ep of [...(episodes || [])].sort((a,b) => Date.parse(a.airDateUtc) - Date.parse(b.airDateUtc))) {
    const date = new Date(ep.airDateUtc).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
    if (!groups.has(date)) groups.set(date, [])
    groups.get(date).push(ep)
  }
  return <section className="upcoming-tab"><h1>Upcoming</h1><p className="text-muted">Yesterday through the next 14 days · local time</p>
    {error ? <div role="alert"><p>{error}</p><button className="btn btn-secondary" onClick={refresh}>Retry</button></div> : !episodes ? <p>Loading upcoming episodes…</p> : episodes.length === 0 ? <p>No episodes scheduled in this window.</p> : [...groups].map(([date, items]) => <section key={date}><h2 className="section-title">{date}</h2>
      {items.map(ep => <button className="card upcoming-row" key={ep.id} onClick={() => onShow(ep.seriesId || ep.series?.id)} disabled={!(ep.seriesId || ep.series?.id)}>
        <Poster media={ep.series || {}} /><span className="upcoming-info"><strong>{ep.series?.title || 'Unknown show'}</strong><span>S{String(ep.seasonNumber).padStart(2,'0')}E{String(ep.episodeNumber).padStart(2,'0')} · {ep.title}</span><time dateTime={ep.airDateUtc}>{new Date(ep.airDateUtc).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time><span className="badge badge-muted">{episodeStatus(ep)}</span></span>
      </button>)}
    </section>)}
  </section>
}
