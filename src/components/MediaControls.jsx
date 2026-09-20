import { useState } from 'react'
import { checkedFetch } from '../actions'

export function Poster({ media }) {
  const url = media.images?.find(image => image.coverType === 'poster')?.remoteUrl
  const [failed, setFailed] = useState(false)
  return url && /^https?:\/\//.test(url) && !failed
    ? <img className="media-poster" src={url} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
    : <span className="media-poster poster-placeholder" aria-hidden="true">🎞</span>
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
  return <button className="btn btn-secondary btn-sm" aria-label={`Monitored: ${media.title}`} aria-pressed={Boolean(media.monitored)} disabled={pending} onClick={toggle}>{pending ? 'Saving…' : media.monitored ? '✓ Monitored' : 'Unmonitored'}</button>
}
export function supportsMovieRemoval(identity) {
  if (identity?.capabilities?.includes('movieDelete')) return true
  const parts = /^(\d+)\.(\d+)(?:\.(\d+))?$/.exec(identity?.version || '')
  return Boolean(parts && (Number(parts[1]) > 1 || (Number(parts[1]) === 1 && Number(parts[2]) >= 8)))
}
