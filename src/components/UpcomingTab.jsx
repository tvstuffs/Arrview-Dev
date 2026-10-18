import useUpcoming from '../hooks/useUpcoming'
import { groupByDay, timeText } from '../upcoming'
import { Poster } from './MediaControls'

// Re-exported so existing imports keep working; the logic lives in src/upcoming.js.
export { calendarRange, episodeStatus } from '../upcoming'

const SERVICES = [['sonarr', 'Sonarr'], ['radarr', 'Radarr']]
const BADGE = { downloaded: 'Downloaded', missing: 'Missing' }
const pad = n => String(n).padStart(2, '0')

function badgeText(entry) {
  return entry.status === 'partial' ? `${entry.done} of ${entry.count}` : BADGE[entry.status] || 'Upcoming'
}
function subtitle(entry) {
  if (entry.kind !== 'episode') return entry.subtitle
  const ep = entry.firstEpisode
  return `S${pad(entry.season)}E${pad(entry.episodeNumbers[0])} · ${ep.title}`
}

export default function UpcomingTab({ config, onShow, onMovie }) {
  const { entries, loading, errors, retry } = useUpcoming(config)
  const failed = SERVICES.filter(([id]) => errors[id])
  const days = groupByDay(entries)
  return <section className="upcoming-tab"><h1>Upcoming</h1><p className="text-muted">Yesterday through the next 14 days · local time</p>
    {failed.map(([id, label]) => <div role="alert" key={id}><p>{errors[id]}</p><button className="btn btn-secondary" aria-label={`Retry ${label} upcoming`} onClick={() => retry(id)}>Retry</button></div>)}
    {loading ? <p role="status">Loading upcoming…</p> : days.length === 0 ? (failed.length ? null : <p>Nothing scheduled in this window</p>) : days.map(day => <section key={day.dayKey}>
      <h2 className="section-title">{day.date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</h2>
      {day.entries.map(entry => {
        const movie = entry.kind === 'movie'
        const target = movie ? entry.movieId : entry.seriesId
        return <button className="card upcoming-row" key={entry.key} onClick={() => (movie ? onMovie?.(entry.movieId) : onShow?.(entry.seriesId))} disabled={!target}>
          <Poster media={(movie ? entry.movie : entry.series) || {}} /><span className="upcoming-info"><strong>{entry.title}</strong><span>{subtitle(entry)}</span>
            {!movie && <time dateTime={new Date(entry.at).toISOString()}>{timeText(entry.at)}</time>}
            <span className="badge badge-muted">{badgeText(entry)}</span></span>
        </button>
      })}
    </section>)}
  </section>
}
