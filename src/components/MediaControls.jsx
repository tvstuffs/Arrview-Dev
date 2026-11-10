import { useState } from 'react'
import { checkedFetch } from '../actions'
import Icon from './Icon.jsx'

export function Poster({ media }) {
  const url = media.images?.find(image => image.coverType === 'poster')?.remoteUrl
  const [failed, setFailed] = useState(false)
  return url && /^https?:\/\//.test(url) && !failed
    ? <img className="media-poster" src={url} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
    : <span className="media-poster poster-placeholder" aria-hidden="true"><Icon name="film-slate" /></span>
}
export function MonitorToggle({ media, service, onChanged, onToast }) {
  const [pending, setPending] = useState(false)
  async function toggle() {
    setPending(true)
    try {
      await checkedFetch(service === 'sonarr' ? `/api/sonarr/series/${media.id}` : '/api/radarr/movie/monitor', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(service === 'sonarr' ? { monitored: !media.monitored } : { movieIds: [media.id], monitored: !media.monitored }),
      })
      await onChanged()
    } catch (e) { onToast(`Monitoring failed: ${e.message}`, 'error') }
    finally { setPending(false) }
  }
  return <button className="btn btn-icon monitor-toggle" aria-label={`Monitored: ${media.title}`} title={media.monitored ? 'Monitored' : 'Unmonitored'} aria-pressed={Boolean(media.monitored)} aria-busy={pending || undefined} disabled={pending} onClick={toggle}>
    <span className={pending ? 'monitor-hidden' : undefined}><Icon name="bookmark-simple" weight={media.monitored ? 'fill' : 'regular'} /></span>
    <span className={`monitor-saving${pending ? '' : ' monitor-hidden'}`}><span className="spinner" style={{ width: 14, height: 14 }} />Saving…</span>
  </button>
}
// A season's monitoring control. `state` is seasonMonitoring's answer: when the whole season is monitored it reads "Monitored" and a
// press unmonitors it; otherwise it reads "Monitor season" and a press monitors the season and every episode in it. The server sets
// both in Sonarr. The page is read again whatever the outcome, because a change that failed half way has still changed Sonarr.
export function SeasonMonitorButton({ show, season, state, onChanged, onToast, size = 'sm' }) {
  const [pending, setPending] = useState(false)
  const on = state === 'on'
  async function toggle() {
    setPending(true)
    try {
      await checkedFetch(`/api/sonarr/series/${show.id}/season/${season}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ monitored: !on }),
      })
      onToast(on ? `Season ${season} is no longer monitored in Sonarr` : `Season ${season} is monitored in Sonarr`, 'info')
    } catch (e) { onToast(`Monitoring failed: ${e.message}`, 'error') }
    try { await onChanged() } finally { setPending(false) }
  }
  return <button className={`btn btn-secondary btn-${size} season-monitor`} disabled={pending} aria-busy={pending || undefined} onClick={toggle}
    aria-label={on ? `Monitored, Season ${season}. Press to unmonitor` : `Monitor season ${season}`}
    title={on ? `Season ${season} is monitored. Press to unmonitor it` : `Monitor every episode of Season ${season}`}>
    {pending ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <Icon name="bookmark-simple" weight={on ? 'fill' : 'regular'} />} {on ? 'Monitored' : 'Monitor season'}
  </button>
}
export function supportsMovieRemoval(identity) {
  if (identity?.capabilities?.includes('movieDelete')) return true
  const parts = /^(\d+)\.(\d+)(?:\.(\d+))?$/.exec(identity?.version || '')
  return Boolean(parts && (Number(parts[1]) > 1 || (Number(parts[1]) === 1 && Number(parts[2]) >= 8)))
}
