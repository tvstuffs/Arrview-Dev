import { useState } from 'react'
import Icon from '../Icon.jsx'
import PageHeader from './PageHeader.jsx'
import ViewToggle from './ViewToggle.jsx'
import FilterChips from './FilterChips.jsx'
import ArtImage from './ArtImage.jsx'
import useUpcoming from '../../hooks/useUpcoming'
import { usePreference, oneOf } from '../../hooks/usePreference'
import { artUrl } from '../../media'
import { groupByDay, entryLabel, timeText } from '../../upcoming'

const FILTERS = [['all', 'All'], ['tv', 'TV'], ['movies', 'Movies']]
const VIEWS = [
  { value: 'thumbs', label: 'Thumbnails', icon: 'squares-four' },
  { value: 'list', label: 'List', icon: 'list' },
]
const SERVICES = [['sonarr', 'Sonarr'], ['radarr', 'Radarr']]
const RELATIVE = { today: 'Today', tomorrow: 'Tomorrow', yesterday: 'Yesterday' }
const RELEASE = { digital: ['monitor-play', 'Digital'], physical: ['disc', 'Physical'] }

function statusText(entry) {
  if (entry.status === 'downloaded') return 'Downloaded'
  if (entry.status === 'missing') return 'Missing'
  return entry.status === 'partial' ? `${entry.done} of ${entry.count}` : null
}

// One link per entry (no interactive descendants); an entry without an id keeps the content as a plain block.
function EntryLink({ entry, className, children }) {
  const movie = entry.kind === 'movie'
  const id = movie ? entry.movieId : entry.seriesId
  if (id === null || id === undefined) return <div className={className}>{children}</div>
  return <a className={className} href={`#/${movie ? 'movies' : 'shows'}/${id}`} aria-label={entryLabel(entry)}>{children}</a>
}

function StatusBadge({ entry }) {
  const text = statusText(entry)
  if (!text) return null
  return <span className={`m-utile-badge${entry.status === 'downloaded' ? ' is-ok' : ' is-attn'}`}>
    {entry.status === 'downloaded' && <Icon name="check" />}{text}
  </span>
}

function ReleaseBadge({ entry }) {
  const [icon, text] = RELEASE[entry.release]
  return <span className="m-utile-badge"><Icon name={icon} />{text}</span>
}

function posterSrcs(entry) {
  return entry.kind === 'movie' ? [artUrl(entry.movie, 'poster', 'grid')] : [artUrl(entry.series, 'poster', 'grid')]
}

// Decorative blurred copy of the poster behind a movie tile; hidden if the image fails.
function BlurCopy({ src }) {
  const [failed, setFailed] = useState(false)
  return src && !failed
    ? <img className="m-utile-blur" src={src} alt="" aria-hidden="true" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
    : null
}

function Tile({ entry }) {
  const movie = entry.kind === 'movie'
  const drop = entry.kind === 'drop'
  const poster = posterSrcs(entry)
  const stillSrcs = [artUrl(entry.firstEpisode, 'screenshot', 'still'), artUrl(entry.series, 'fanart', 'detail'), ...poster]
  return <EntryLink entry={entry} className={`m-utile is-${entry.kind}`}>
    <span className="m-utile-stack">
      <span className="m-utile-box">
        {movie
          ? <>
            <BlurCopy src={poster[0]} />
            <ArtImage srcs={poster} className="m-utile-poster" icon="film-slate" />
          </>
          : <ArtImage srcs={stillSrcs} className="m-art-still m-utile-still" icon="television-simple" />}
        <span className="m-utile-badges">
          <span className="m-utile-badgerow">
            {movie ? <ReleaseBadge entry={entry} /> : <span className="m-utile-badge">{timeText(entry.at)}</span>}
            {drop && <span className="m-utile-badge"><Icon name="stack" />{entry.count} episodes</span>}
          </span>
          <StatusBadge entry={entry} />
        </span>
      </span>
    </span>
    <span className="m-utile-title">{entry.title}</span>
    <span className="m-utile-meta">{entry.subtitle}</span>
  </EntryLink>
}

function Row({ entry }) {
  const movie = entry.kind === 'movie'
  const text = statusText(entry)
  return <EntryLink entry={entry} className="m-ulist-row">
    <span className="m-ulist-time">
      {movie ? <><Icon name={RELEASE[entry.release][0]} />{RELEASE[entry.release][1]}</> : timeText(entry.at)}
    </span>
    <ArtImage srcs={posterSrcs(entry)} className="m-art-poster m-ulist-thumb" width="40" height="60" icon={movie ? 'film-slate' : 'television-simple'} />
    <span className="m-ulist-text">
      <span className="m-row-title">{entry.title}</span>
      <span className="m-row-meta">{entry.subtitle}</span>
    </span>
    <span className={`m-ulist-state${entry.status === 'downloaded' ? ' is-ok' : text ? ' m-attn' : ''}`}>
      {text
        ? <>{entry.status === 'downloaded' && <Icon name="check" />}{text}</>
        : entry.kind === 'drop' ? <><Icon name="stack" />{entry.count} episodes</> : null}
    </span>
  </EntryLink>
}

function Agenda({ days }) {
  let lastMonth = null
  return <div className="m-agenda">
    {days.map(day => {
      const month = day.dayKey.slice(0, 7)
      const showMonth = month !== lastMonth
      lastMonth = month
      return <section key={day.dayKey} className={`m-agenda-day${day.relative === 'today' ? ' is-today' : ''}${day.relative === 'yesterday' ? ' is-past' : ''}`}>
        <h2 className="m-agenda-date">
          <span className="m-sr">{day.date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</span>
          <span aria-hidden="true" className="m-agenda-month">{showMonth ? day.date.toLocaleDateString(undefined, { month: 'short' }) : ''}</span>
          <span aria-hidden="true" className="m-agenda-num">{day.date.getDate()}</span>
          <span aria-hidden="true" className="m-agenda-weekday">{day.date.toLocaleDateString(undefined, { weekday: 'short' })}</span>
          <span aria-hidden="true" className="m-agenda-rel">{RELATIVE[day.relative] || ''}</span>
        </h2>
        <ul className="m-agenda-tiles">{day.entries.map(entry => <li key={entry.key}><Tile entry={entry} /></li>)}</ul>
      </section>
    })}
  </div>
}

function List({ days }) {
  return <div className="m-ulist">
    {days.map(day => {
      const date = day.date.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
      return <section key={day.dayKey}>
        <h2 className="m-ulist-day">{day.relative ? `${RELATIVE[day.relative]} ` : ''}{date}</h2>
        <ul className="m-ulist-rows">{day.entries.map(entry => <li key={entry.key}><Row entry={entry} /></li>)}</ul>
      </section>
    })}
  </div>
}

export default function UpcomingPage({ config, phone }) {
  const { entries, loading, errors, retry, sources } = useUpcoming(config)
  const [filter, setFilter] = usePreference('upcoming.filter', 'all', oneOf(FILTERS.map(([v]) => v)))
  const [view, setView] = usePreference('upcoming.view', 'thumbs', oneOf(VIEWS.map(v => v.value)))
  const both = sources.tv && sources.movies
  const effective = both ? filter : 'all'
  const shown = entries.filter(entry => effective === 'all' || (effective === 'movies') === (entry.kind === 'movie'))
  const days = groupByDay(shown)
  const failed = SERVICES.filter(([id]) => errors[id])

  let body
  if (loading) body = <div className="empty-state" role="status"><span className="spinner" /><span>Loading upcoming…</span></div>
  else body = <>
    <div className="m-controls">
      {both && <FilterChips options={FILTERS} value={filter} onChange={setFilter} label="Show" />}
      <ViewToggle value={view} onChange={setView} options={VIEWS} />
    </div>
    {failed.map(([id, label]) => <div className="empty-state m-uerror" role="alert" key={id}>
      <div className="empty-state-icon"><Icon name="warning" /></div>
      <strong>{errors[id]}</strong>
      <button className="btn btn-secondary mt-4" aria-label={`Retry ${label} upcoming`} onClick={() => retry(id)}>Retry</button>
    </div>)}
    {days.length === 0
      ? !failed.length && <div className="empty-state">
        <div className="empty-state-icon"><Icon name="calendar-dots" /></div>
        <span>Nothing scheduled in this window</span>
      </div>
      : view === 'list' ? <List days={days} /> : <Agenda days={days} />}
  </>
  return <div className="m-page m-upcoming">
    <PageHeader title="Upcoming" phone={phone} gear />
    <p className="m-meta">Yesterday through the next 14 days · local time</p>
    {body}
  </div>
}
