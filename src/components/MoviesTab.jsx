import { useState, useCallback, useEffect } from 'react'
import './MoviesTab.css'
import { usePreference, textPreference, oneOf } from '../hooks/usePreference'
import { useVisiblePolling, useServerEvents } from '../hooks/lifecycle'
import AddMediaModal from './AddMediaModal.jsx'

import { Poster, MonitorToggle, supportsMovieRemoval } from './MediaControls'
import ReleaseSearchModal from './ReleaseSearchModal'
import Icon from './Icon.jsx'
import { MovieDeleteSheet } from './MediaSheets'
import { useMediaActions } from '../hooks/useMediaActions'
import { checkedFetch } from '../actions'
import { MOVIE_STATUS, getMovieStatus, isMovieMissing, movieFileLine } from '../media'

function MovieCard({ movie, onChanged, onToast, identity, view = "list" }) {
  const [interactive, setInteractive] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const canRemove = supportsMovieRemoval(identity)
  const [searching, setSearching] = useState(false)
  const actions = useMediaActions(onToast)
  const statusKey = getMovieStatus(movie)
  const statusInfo = MOVIE_STATUS[statusKey] || { label: statusKey, cls: 'badge-muted' }

  async function handleSearch(e) {
    e.stopPropagation()
    setSearching(true)
    try { await actions.searchMovie(movie) } finally { setSearching(false) }
  }

  const canSearch = isMovieMissing(movie)

  const posters = view === 'posters' || view === 'small'
  const monitorToggle = <MonitorToggle media={movie} service="radarr" onChanged={onChanged} onToast={onToast} />
  const interactiveButton = <button className="btn btn-icon" onClick={() => setInteractive(true)} aria-label="Interactive Search" title="Interactive Search"><Icon name="magnifying-glass" /></button>
  const deleteButton = <button className="btn btn-icon btn-icon-danger" onClick={() => setConfirm(true)} aria-label={`Delete ${movie.title}`} title={`Delete ${movie.title}`}><Icon name="trash" /></button>
  const downloadButton = canSearch && (
    <button className={`btn btn-attn btn-sm ${posters ? 'tile-download' : 'ml-auto'}`} onClick={handleSearch} disabled={searching}>
      {searching ? <span className="spinner" style={{width:12,height:12}} /> : <Icon name="download-simple" />} Download
    </button>
  )

  return (
    <div className={posters ? `movie-tile ${movie.hasFile ? '' : 'is-missing'}` : 'movie-card card'} title={view === 'small' ? movie.title : undefined}>
      {posters ? <>
        <div className="tile-art">
          <Poster media={movie} />
          <span className={`badge text-xs tile-badge ${statusInfo.cls}`}>{statusInfo.label}</span>
          <div className="tile-actions">
            {downloadButton}
            <div className="tile-actions-row">{interactiveButton}{monitorToggle}{deleteButton}</div>
          </div>
        </div>
        <div className="tile-title truncate" title={movie.title}>{movie.title}</div>
        <div className="tile-sub truncate">{[movie.year, movie.studio].filter(Boolean).join(' · ')}</div>
      </> : <>
      <div className="movie-header">
        <Poster media={movie} />
        <div className="movie-info">
          <div className="movie-title font-semibold truncate" title={movie.title}>{movie.title}</div>
          <div className="movie-meta">
            {movie.year && <span className="text-xs text-muted">{movie.year}</span>}
            {movie.studio && <span className="text-xs text-secondary truncate">{movie.studio}</span>}
          </div>
          <span className={`badge text-xs ${statusInfo.cls}`}>{statusInfo.label}</span>
        </div>
      </div>

      {movie.overview && (
        <p className="movie-overview text-sm text-secondary">{movie.overview}</p>
      )}

      <div className="movie-footer">
        {movieFileLine(movie) && <span className="text-xs text-muted">{movieFileLine(movie)}</span>}
        {monitorToggle}
        {interactiveButton}
        {deleteButton}
        {downloadButton}
      </div>
      </>}
      {interactive && <ReleaseSearchModal movie={movie} onClose={() => setInteractive(false)} onToast={onToast} />}
      {confirm && <MovieDeleteSheet movie={movie} canRemove={canRemove}
        onUnmonitor={() => actions.unmonitorMovie(movie)} onRemove={() => actions.removeMovie(movie)}
        onClose={() => { setConfirm(false); onChanged() }} />}
    </div>
  )
}



export default function MoviesTab({ onToast }) {
  const [movies, setMovies] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = usePreference('movies.search', '', textPreference)
  const [filter, setFilter] = usePreference('movies.filter', 'all', oneOf(['all','downloaded','missing','monitored']))
  const [sort, setSort] = usePreference('movies.sort', 'alpha', oneOf(['alpha','year','added','downloaded']))
  const [view, setView] = usePreference('movies.view', 'list', oneOf(['list','posters','small']))
  const [identity, setIdentity] = useState(null)
  const actions = useMediaActions(onToast)
  useEffect(() => { checkedFetch('/api/arrview/identify').then(setIdentity).catch(() => {}) }, [])
  const [showAddModal, setShowAddModal] = useState(false)

  const fetchMovies = useCallback(async () => {
    try {
      const r = await fetch('/api/radarr/movies')
      if (!r.ok) throw new Error((await r.json()).error)
      const data = await r.json()
      setMovies(Array.isArray(data) ? data : [])
      setError(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useVisiblePolling(fetchMovies, 60000)
  useServerEvents('radarr', fetchMovies)

  if (loading) {
    return <div className="empty-state"><span className="spinner" /><span>Loading movies…</span></div>
  }

  if (error) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon"><Icon name="warning" /></div>
        <strong>Cannot reach Radarr</strong>
        <p className="text-sm text-muted">{error}</p>
        <button className="btn btn-secondary mt-4" onClick={fetchMovies}>Retry</button>
      </div>
    )
  }

  const downloaded = movies.filter(m => m.hasFile).length
  const missing    = movies.filter(isMovieMissing).length

  let filtered = movies.filter(m => {
    if (search && !m.title.toLowerCase().includes(search.toLowerCase())) return false
    if (filter === 'downloaded') return m.hasFile
    if (filter === 'missing')    return isMovieMissing(m)
    if (filter === 'monitored')  return m.monitored && !m.hasFile
    return true
  })

  if (sort === 'alpha') filtered.sort((a, b) => a.title.localeCompare(b.title))
  else if (sort === 'year') filtered.sort((a, b) => (b.year || 0) - (a.year || 0))
  else if (sort === 'added') filtered.sort((a, b) => new Date(b.added) - new Date(a.added))

  else if (sort === 'downloaded') filtered.sort((a, b) => (Date.parse(b.movieFile?.dateAdded) || 0) - (Date.parse(a.movieFile?.dateAdded) || 0))

  const downloadAllMissing = () => actions.downloadAllMissing(movies)

  return (
    <div className="movies-tab">
      {/* Stats */}
      <div className="movies-stats">
        <div className="stat-chip">
          <span className="stat-chip-value">{movies.length}</span>
          <span className="stat-chip-label">Total Movies</span>
        </div>
        <div className="stat-chip">
          <span className="stat-chip-value">{downloaded}</span>
          <span className="stat-chip-label">Downloaded</span>
        </div>
        <div className="stat-chip">
          <span className="stat-chip-value text-attn">{missing}</span>
          <span className="stat-chip-label">Missing</span>
        </div>
        {missing > 0 && (
          <button className="btn btn-attn btn-sm ml-auto" onClick={downloadAllMissing}>
            <Icon name="download-simple" /> Download All Missing ({missing})
          </button>
        )}
        <button
          className={`btn btn-primary btn-sm ${missing === 0 ? 'ml-auto' : ''}`}
          onClick={() => setShowAddModal(true)}
        >
          + Add Movie
        </button>
      </div>

      {/* Controls */}
      <div className="movies-controls">
        <div className="search-input">
          <Icon name="magnifying-glass" className="icon search-input-icon" />
          <input
            type="text"
            aria-label="Search movies" placeholder="Search movies…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="filter-buttons">
          {[['all','All'],['downloaded','Downloaded'],['missing','Missing'],['monitored','Monitored']].map(([v,l]) => (
            <button
              key={v}
              aria-pressed={filter === v}
              onClick={() => setFilter(v)}
            >{l}</button>
          ))}
        </div>
        <select
          aria-label="Sort results" className="sort-select"
          value={sort}
          onChange={e => setSort(e.target.value)}
        >
          <option value="alpha">A–Z</option>
          <option value="year">Newest First</option>
          <option value="added">Recently Added</option>
          <option value="downloaded">Recently Downloaded</option>
        </select>
      </div>

      <div className="filter-buttons" aria-label="Movie view">
        {[['list', 'List'], ['posters', 'Posters'], ['small', 'Small posters']].map(([value, label]) => <button key={value} aria-pressed={view === value} onClick={() => setView(value)}>{label}</button>)}
      </div>
      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon"><Icon name="film-slate" /></div>
          <span>No movies match your filter</span>
        </div>
      ) : (
        <div className={`movies-grid movies-${view}`}>
          {filtered.map(movie => (
            <MovieCard key={movie.id} movie={movie} view={view} onToast={onToast} onChanged={fetchMovies} identity={identity} />
          ))}
        </div>
      )}

      {showAddModal && (
        <AddMediaModal
          type="movie"
          onClose={() => setShowAddModal(false)}
          onAdded={fetchMovies}
          onToast={onToast}
        />
      )}
    </div>
  )
}
