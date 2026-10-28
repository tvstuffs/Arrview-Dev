import { useState } from 'react'
import Icon from '../Icon.jsx'
import AddMediaModal from '../AddMediaModal.jsx'
import { MonitorToggle } from '../MediaControls'
import PageHeader from './PageHeader.jsx'
import ViewToggle, { VIEW_VALUES } from './ViewToggle.jsx'
import FilterChips from './FilterChips.jsx'
import ArtImage from './ArtImage.jsx'
import { useSeries } from './LibraryProvider.jsx'
import { useMediaActions } from '../../hooks/useMediaActions'
import { usePreference, textPreference, oneOf } from '../../hooks/usePreference'
import { mainSeasonCounts, artUrl, completenessTone } from '../../media'

const FILTERS = [['all', 'All'], ['missing', 'Has Missing'], ['continuing', 'Continuing'], ['ended', 'Ended']]
const capitalise = text => text ? text.charAt(0).toUpperCase() + text.slice(1) : ''
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

export function showStats(show) {
  const { total, onDisk } = mainSeasonCounts(show)
  return { total, onDisk, missing: Math.max(0, total - onDisk), pct: total > 0 ? Math.round((onDisk / total) * 100) : 0 }
}

function ShowTile({ show, small }) {
  const { total, onDisk, missing, pct } = showStats(show)
  const tone = completenessTone(onDisk, total)
  const unmonitored = !show.monitored
  const meta = unmonitored ? 'Unmonitored' : missing > 0 ? `${missing} missing` : [show.network, show.year].filter(Boolean).join(' · ')
  const metaId = `show-meta-${show.id}`
  return <li>
    <a className="m-tile" href={`#/shows/${show.id}`} aria-label={show.title} title={small ? show.title : undefined} aria-describedby={small ? undefined : metaId}>
      <span className={`m-poster${unmonitored ? ' is-grey' : ''}`}>
        <ArtImage srcs={[artUrl(show, 'poster', 'grid')]} className="m-art-poster" width="200" height="300" icon="television-simple" />
        {!unmonitored && tone !== 'none' && <span className="m-tilebar" aria-hidden="true"><span className={`is-${tone}`} style={{ width: `${pct}%` }} /></span>}
      </span>
      {!small && <>
        <span className="m-tile-title">{show.title}</span>
        <span className={`m-tile-meta${!unmonitored && missing > 0 ? ' is-attn' : ''}`} id={metaId}>{meta}</span>
      </>}
    </a>
  </li>
}

function ShowRow({ show, actions, onToast, refresh }) {
  const { total, onDisk, missing, pct } = showStats(show)
  const [searching, setSearching] = useState(false)
  async function search() { setSearching(true); try { await actions.searchSeries(show) } finally { setSearching(false) } }
  return <li className="m-row">
    <a className="m-row-link" href={`#/shows/${show.id}`}>
      <ArtImage srcs={[artUrl(show, 'poster', 'grid')]} className="m-art-poster m-thumb" width="64" height="96" icon="television-simple" />
      <span className="m-row-text">
        <span className="m-row-title">{show.title}</span>
        <span className="m-row-meta">{[show.network, show.year, capitalise(show.status)].filter(Boolean).join(' · ')}</span>
        <span className="m-progress">
          <span className="m-progress-bar" aria-hidden="true"><span className={`is-${completenessTone(onDisk, total)}`} style={{ width: `${pct}%` }} /></span>
          <span>{onDisk} of {total} episodes</span>
          {missing > 0 && <span className="m-attn">{missing} missing</span>}
        </span>
      </span>
    </a>
    <div className="m-row-actions">
      {missing > 0 && <button className="btn btn-attn btn-sm" title={`Search for all missing episodes of ${show.title}`} disabled={searching} onClick={search}>
        {searching ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <Icon name="download-simple" />} Search Missing
      </button>}
      <MonitorToggle media={show} service="sonarr" onChanged={refresh} onToast={onToast} />
    </div>
  </li>
}

export default function ShowsPage({ phone, onToast }) {
  const { series, loading, error, refresh } = useSeries()
  const [search, setSearch] = usePreference('shows.search', '', textPreference)
  const [filter, setFilter] = usePreference('shows.filter', 'all', oneOf(FILTERS.map(([v]) => v)))
  const [sort, setSort] = usePreference('shows.sort', 'alpha', oneOf(['alpha', 'missing', 'year']))
  const [view, setView] = usePreference('shows.view', 'posters', oneOf(VIEW_VALUES))
  const [adding, setAdding] = useState(false)
  const actions = useMediaActions(onToast)
  const header = <PageHeader title="TV Shows" phone={phone} addLabel="Add Show" onAdd={() => setAdding(true)} gear />

  let body
  if (loading) body = <div className="empty-state" role="status"><span className="spinner" /><span>Loading shows…</span></div>
  else if (error) body = <div className="empty-state">
    <div className="empty-state-icon"><Icon name="warning" /></div>
    <strong>Cannot reach Sonarr</strong>
    <p className="text-sm text-muted">{error}</p>
    <button className="btn btn-secondary mt-4" onClick={refresh}>Retry</button>
  </div>
  else {
    const totalMissing = series.reduce((sum, s) => sum + showStats(s).missing, 0)
    const filtered = series.filter(s => {
      if (search && !s.title.toLowerCase().includes(search.toLowerCase())) return false
      if (filter === 'missing') return showStats(s).missing > 0
      if (filter === 'continuing') return s.status?.toLowerCase() === 'continuing'
      if (filter === 'ended') return s.status?.toLowerCase() === 'ended'
      return true
    })
    if (sort === 'alpha') filtered.sort((a, b) => a.title.localeCompare(b.title))
    else if (sort === 'missing') filtered.sort((a, b) => showStats(b).missing - showStats(a).missing)
    else if (sort === 'year') filtered.sort((a, b) => (b.year || 0) - (a.year || 0))
    body = <>
      <p className="m-meta">
        <span>{plural(series.length, 'show', 'shows')}</span>
        {totalMissing > 0 && <> <span aria-hidden="true">·</span> <button className="m-missing-link" onClick={() => setFilter('missing')}>{plural(totalMissing, 'missing episode', 'missing episodes')}</button></>}
      </p>
      <div className="m-controls">
        <div className="m-search">
          <Icon name="magnifying-glass" />
          <input type="text" aria-label="Search shows" placeholder="Search shows…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <FilterChips options={FILTERS} value={filter} onChange={setFilter} />
        <select className="m-select" aria-label="Sort results" value={sort} onChange={e => setSort(e.target.value)}>
          <option value="alpha">A–Z</option>
          <option value="missing">Most Missing</option>
          <option value="year">Newest First</option>
        </select>
        <ViewToggle value={view} onChange={setView} />
      </div>
      {filtered.length === 0
        ? <div className="empty-state">
          <div className="empty-state-icon"><Icon name="television-simple" /></div>
          <span>No shows match your filter</span>
        </div>
        : view === 'list'
          ? <ul className="m-list">{filtered.map(show => <ShowRow key={show.id} show={show} actions={actions} onToast={onToast} refresh={refresh} />)}</ul>
          : <ul className={`m-grid ${view === 'small' ? 'is-small' : 'is-large'}`}>{filtered.map(show => <ShowTile key={show.id} show={show} small={view === 'small'} />)}</ul>}
    </>
  }
  return <div className="m-page">
    {header}
    {body}
    {adding && <AddMediaModal type="show" library={series} onClose={() => setAdding(false)} onAdded={refresh} onToast={onToast} />}
  </div>
}
