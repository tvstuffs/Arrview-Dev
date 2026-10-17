import { useState, useCallback } from 'react'
import Icon from '../Icon.jsx'
import { MonitorToggle } from '../MediaControls'
import EpisodeSearchModal from '../EpisodeSearchModal.jsx'
import { RemoveSeriesSheet, SeasonDeleteSheet, EpisodeDeleteSheet } from '../MediaSheets'
import ArtImage from './ArtImage.jsx'
import NotFound from './NotFound.jsx'
import { SettingsLink } from './PageHeader.jsx'
import { useSeries } from './LibraryProvider.jsx'
import { showStats } from './ShowsPage.jsx'
import { useMediaActions } from '../../hooks/useMediaActions'
import { useVisiblePolling, useServerEvents } from '../../hooks/lifecycle'
import { artUrl, episodeState } from '../../media'

const capitalise = text => text ? text.charAt(0).toUpperCase() + text.slice(1) : ''
const goToShows = () => { window.location.hash = '/shows' }

function EpisodeItem({ ep, fanart, onSearch, onInteractive, onDelete }) {
  const state = episodeState(ep)
  const date = ep.airDateUtc ? new Date(ep.airDateUtc).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : null
  const meta = [`Episode ${ep.episodeNumber}`, date, state === 'missing' ? 'Missing' : state === 'upcoming' ? 'Upcoming' : null].filter(Boolean)
  return <li className={`m-ep is-${state}`}>
    <div className="m-still">
      <ArtImage srcs={[artUrl(ep, 'screenshot', 'still'), fanart]} className="m-art-still" width="320" height="180" icon="television-simple" />
      {ep.runtime > 0 && <span className="m-runtime">{ep.runtime}m</span>}
    </div>
    <div className="m-ep-body">
      <h3>{ep.title}</h3>
      <p className="m-ep-meta">{meta.map((part, index) => <span key={part} className={part === 'Missing' ? 'm-attn' : undefined}>{index > 0 ? ' · ' : ''}{part}</span>)}</p>
      {ep.overview && <p className="m-ep-overview">{ep.overview}</p>}
    </div>
    <div className="m-ep-actions">
      {state === 'downloaded' && <>
        <span className="m-ok"><Icon name="check" />Downloaded</span>
        <button className="btn btn-icon btn-icon-danger" aria-label={`Delete and unmonitor ${ep.title}`} title="Delete from disk and unmonitor" onClick={() => onDelete(ep)}><Icon name="trash" /></button>
      </>}
      {state === 'missing' && <>
        <button className="btn btn-attn btn-sm" onClick={() => onSearch(ep.id)}><Icon name="download-simple" /> Download</button>
        <button className="btn btn-icon" aria-label="Interactive search — pick a release manually" title="Interactive search — pick a release manually" onClick={() => onInteractive(ep)}><Icon name="magnifying-glass" /></button>
      </>}
    </div>
  </li>
}

function ShowDetail({ show, phone, onToast, config, refresh }) {
  const actions = useMediaActions(onToast)
  const [episodes, setEpisodes] = useState(null)
  const [selected, setSelected] = useState(null)
  const [searching, setSearching] = useState(false)
  const [interactiveEp, setInteractiveEp] = useState(null)
  const [confirmSeason, setConfirmSeason] = useState(null)
  const [confirmEpisode, setConfirmEpisode] = useState(null)
  const [confirmRemove, setConfirmRemove] = useState(false)

  const fetchEpisodes = useCallback(async () => {
    try {
      const data = await (await fetch(`/api/sonarr/series/${show.id}/episodes`)).json()
      setEpisodes(Array.isArray(data) ? data : [])
    } catch { setEpisodes(prev => prev ?? []) }
  }, [show.id])
  useVisiblePolling(fetchEpisodes, 15000)
  useServerEvents('sonarr', event => { if (!event || event.seriesId == null || event.seriesId === show.id) fetchEpisodes() })

  const { total, onDisk, missing, pct } = showStats(show)
  const fanart = artUrl(show, 'fanart', 'backdrop')
  const poster = artUrl(show, 'poster', 'detail')
  const sonarrUrl = config.sonarr?.url
  const meta = [show.year, show.network, ...(show.genres || []).slice(0, 3), capitalise(show.status)].filter(Boolean).join(' · ')

  const seasonMap = new Map()
  for (const ep of episodes || []) {
    if (ep.seasonNumber === 0) continue
    if (!seasonMap.has(ep.seasonNumber)) seasonMap.set(ep.seasonNumber, [])
    seasonMap.get(ep.seasonNumber).push(ep)
  }
  const seasons = [...seasonMap.keys()].sort((a, b) => b - a)
  const season = seasonMap.has(selected) ? selected : seasons[0]
  const eps = (seasonMap.get(season) || []).sort((a, b) => b.episodeNumber - a.episodeNumber)
  const downloaded = eps.filter(ep => ep.hasFile).length
  const missingIds = eps.filter(ep => episodeState(ep) === 'missing').map(ep => ep.id)

  async function searchMissing() { setSearching(true); try { await actions.searchSeries(show) } finally { setSearching(false) } }
  async function removeSeries(deleteFiles) { await actions.removeSeries(show, deleteFiles); goToShows() }
  async function deleteSeasonFiles(sn) { try { await actions.deleteSeasonFiles(sn, episodes) } finally { await fetchEpisodes() } }

  return <article className="m-detail m-show">
    <ArtImage ambient srcs={[fanart, poster]} />
    <section className="m-hero">
      <div className="m-hero-nav">
        <a className="m-back" href="#/shows" aria-label="Back to TV Shows"><Icon name="caret-left" /><span>TV Shows</span></a>
        {phone && <SettingsLink className="m-iconbtn m-roundbtn" />}
      </div>
      <div className="m-hero-art">
        <ArtImage srcs={[fanart, poster]} className="m-art-hero" width="1280" height="720" eager icon="television-simple" />
      </div>
      <div className="m-hero-body">
        <h1>{show.title}</h1>
        {meta && <p className="m-hero-meta">{meta}</p>}
        {show.overview && <p className="m-overview">{show.overview}</p>}
        <p className="m-progress">
          <span className="m-progress-bar" aria-hidden="true"><span className={missing > 0 ? 'is-attn' : ''} style={{ width: `${pct}%` }} /></span>
          <span>{onDisk} of {total} episodes</span>
          {missing > 0 && <span className="m-attn">{missing} missing</span>}
        </p>
        <div className="m-hero-actions">
          {missing > 0 && <button className="btn btn-primary" disabled={searching} onClick={searchMissing}>
            {searching ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <Icon name="download-simple" />} Search Missing
          </button>}
          <MonitorToggle media={show} service="sonarr" onChanged={refresh} onToast={onToast} />
          {sonarrUrl && show.titleSlug && <a className="btn btn-icon" href={`${sonarrUrl}/series/${show.titleSlug}`} target="_blank" rel="noopener noreferrer"
            title="Open in Sonarr" aria-label="Open in Sonarr"><Icon name="arrow-square-out" /></a>}
          <button className="btn btn-icon" aria-label={`More actions for ${show.title}`} title="More actions" onClick={() => setConfirmRemove(true)}><Icon name="dots-three" /></button>
        </div>
      </div>
    </section>

    <section className="m-seasons">
      <h2>Episodes</h2>
      {episodes === null
        ? <div className="empty-state" role="status"><span className="spinner" /><span>Loading episodes…</span></div>
        : seasons.length === 0
          ? <p className="text-muted text-sm">No episodes found</p>
          : <>
            <div className="m-chips" role="group" aria-label="Seasons">
              {seasons.map(sn => <button key={sn} aria-pressed={sn === season} onClick={() => setSelected(sn)}>Season {sn}</button>)}
            </div>
            <div className="m-season-bar">
              <span className="m-season-meta">{downloaded} of {eps.length} episodes</span>
              {missingIds.length > 0 && <button className="btn btn-attn btn-sm" onClick={() => actions.searchSeason(season, missingIds)}>Search {missingIds.length} Missing</button>}
              {downloaded > 0 && <button className="btn btn-icon" aria-label={`More actions for Season ${season}`} title={`More actions for Season ${season}`} onClick={() => setConfirmSeason(season)}><Icon name="dots-three" /></button>}
            </div>
            <ul className="m-episodes">
              {eps.map(ep => <EpisodeItem key={ep.id} ep={ep} fanart={fanart} onSearch={actions.searchEpisode} onInteractive={setInteractiveEp} onDelete={setConfirmEpisode} />)}
            </ul>
          </>}
    </section>

    {interactiveEp && <EpisodeSearchModal episode={interactiveEp} seriesTitle={show.title} nzbhydraUrl={config.nzbhydra?.url}
      onClose={() => setInteractiveEp(null)} onToast={onToast} />}
    {confirmRemove && <RemoveSeriesSheet show={show} onRemove={removeSeries} onClose={() => setConfirmRemove(false)} />}
    {confirmSeason !== null && <SeasonDeleteSheet show={show} season={confirmSeason} onDelete={deleteSeasonFiles}
      onClose={() => { setConfirmSeason(null); fetchEpisodes() }} />}
    {confirmEpisode && <EpisodeDeleteSheet ep={confirmEpisode} onDelete={async () => { await actions.deleteEpisode(confirmEpisode); fetchEpisodes() }}
      onClose={() => { setConfirmEpisode(null); fetchEpisodes() }} />}
  </article>
}

export default function ShowPage({ id, phone, onToast, config }) {
  const { series, loading, error, refresh } = useSeries()
  const numeric = /^\d+$/.test(id) ? Number(id) : NaN
  if (!Number.isSafeInteger(numeric)) return <NotFound kind="show" />
  if (loading) return <div className="empty-state" role="status"><h1 className="m-sr" data-m-placeholder>Show</h1><span className="spinner" /><span>Loading show…</span></div>
  if (error) return <div className="empty-state">
    <h1 className="m-sr">Show</h1>
    <div className="empty-state-icon"><Icon name="warning" /></div>
    <strong>Cannot reach Sonarr</strong>
    <p className="text-sm text-muted">{error}</p>
    <button className="btn btn-secondary mt-4" onClick={refresh}>Retry</button>
  </div>
  const show = series.find(s => s.id === numeric)
  if (!show) return <NotFound kind="show" />
  return <ShowDetail show={show} phone={phone} onToast={onToast} config={config} refresh={refresh} />
}
