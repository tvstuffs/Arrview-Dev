import { useState, useCallback, useEffect } from 'react'
import './MoviesTab.css'
import { usePreference, textPreference, oneOf } from '../hooks/usePreference'
import { useVisiblePolling, useServerEvents } from '../hooks/lifecycle'
import AddMediaModal from './AddMediaModal.jsx'

import { Poster, MonitorToggle, supportsMovieRemoval } from './MediaControls'
import ReleaseSearchModal from './ReleaseSearchModal'
import ConfirmSheet from './ConfirmSheet'
import { checkedFetch, deleteMovieAndUnmonitor } from '../actions'

const MOVIE_STATUS = {
  available:    { label: 'Downloaded',   cls: 'badge-success' },
  missing:      { label: 'Missing',      cls: 'badge-danger'  },
  announced:    { label: 'Announced',    cls: 'badge-muted'   },
  inCinemas:    { label: 'In Cinemas',   cls: 'badge-accent'  },
  released:     { label: 'Released',     cls: 'badge-warning' },
}

function getMovieStatus(movie) {
  if (movie.hasFile) return 'available'
  if (!movie.isAvailable) return movie.status || 'announced'
  return 'missing'
}

function MovieCard({ movie, onChanged, onToast, identity }) {
  const [interactive, setInteractive] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const canRemove = supportsMovieRemoval(identity)
  const [searching, setSearching] = useState(false)
  const statusKey = getMovieStatus(movie)
  const statusInfo = MOVIE_STATUS[statusKey] || { label: statusKey, cls: 'badge-muted' }

  async function handleSearch(e) {
    e.stopPropagation()
    setSearching(true)
    try {
      const r = await fetch('/api/radarr/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'MoviesSearch', movieIds: [movie.id] }),
      })
      const data = await r.json()
      if (!r.ok || data.error) throw new Error(data.error)
      onToast(`Searching for "${movie.title}"`, 'success')
    } catch (e) {
      onToast(`Search failed: ${e.message}`, 'error')
    } finally {
      setSearching(false)
    }
  }

  const canSearch = !movie.hasFile && movie.monitored && movie.isAvailable

  return (
    <div className="movie-card card">
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
        {movie.hasFile && movie.movieFile && (
          <span className="text-xs text-muted">{movie.movieFile.quality?.quality?.name || 'Downloaded'} · {movie.movieFile.size != null ? `${(movie.movieFile.size / 1073741824).toFixed(1)} GB` : 'Size unknown'} · {movie.movieFile.mediaInfo?.resolution || movie.movieFile.quality?.quality?.resolution || 'Resolution unknown'} · {movie.movieFile.languages?.map(l => l.name).join(', ') || movie.movieFile.mediaInfo?.audioLanguages || 'Languages unknown'}</span>
        )}
        <MonitorToggle media={movie} service="radarr" onChanged={onChanged} onToast={onToast} />
        <button className="btn btn-secondary btn-sm" onClick={() => setInteractive(true)}>Interactive Search</button>
        <button className="btn btn-danger btn-sm" onClick={() => setConfirm(true)} aria-label={`Delete ${movie.title}`}>Delete…</button>
        {canSearch && (
          <button
            className="btn btn-success btn-sm ml-auto"
            onClick={handleSearch}
            disabled={searching}
          >
            {searching ? <span className="spinner" style={{width:12,height:12}} /> : '⬇'} Download
          </button>
        )}
      </div>
      {interactive && <ReleaseSearchModal movie={movie} onClose={() => setInteractive(false)} onToast={onToast} />}
      {confirm && <ConfirmSheet title="Delete movie?" description={`“${movie.title}”: Delete and Unmonitor deletes the file but keeps the movie in Radarr, unmonitored. Delete and Remove deletes files and removes the movie from Radarr.${canRemove ? '' : ' Removing movies needs ArrView Server 1.08 or later.'}`}
        actions={[
          { label: 'Delete and Unmonitor', run: async () => { await deleteMovieAndUnmonitor(movie); onToast('Movie deleted and unmonitored', 'success') } },
          ...(canRemove ? [{ label: 'Delete and Remove from Radarr', run: async () => { await checkedFetch(`/api/radarr/movie/${movie.id}?deleteFiles=true`, { method: 'DELETE' }); onToast('Movie removed from Radarr', 'success') } }] : []),
        ]} onClose={() => { setConfirm(false); onChanged() }} />}
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
  const [view, setView] = usePreference('movies.view', 'list', oneOf(['list','posters']))
  const [identity, setIdentity] = useState(null)
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
        <div className="empty-state-icon">⚠️</div>
        <strong>Cannot reach Radarr</strong>
        <p className="text-sm text-muted">{error}</p>
        <button className="btn btn-secondary mt-4" onClick={fetchMovies}>Retry</button>
      </div>
    )
  }

  const downloaded = movies.filter(m => m.hasFile).length
  const missing    = movies.filter(m => !m.hasFile && m.monitored && m.isAvailable).length

  let filtered = movies.filter(m => {
    if (search && !m.title.toLowerCase().includes(search.toLowerCase())) return false
    if (filter === 'downloaded') return m.hasFile
    if (filter === 'missing')    return !m.hasFile && m.monitored && m.isAvailable
    if (filter === 'monitored')  return m.monitored && !m.hasFile
    return true
  })

  if (sort === 'alpha') filtered.sort((a, b) => a.title.localeCompare(b.title))
  else if (sort === 'year') filtered.sort((a, b) => (b.year || 0) - (a.year || 0))
  else if (sort === 'added') filtered.sort((a, b) => new Date(b.added) - new Date(a.added))

  else if (sort === 'downloaded') filtered.sort((a, b) => (Date.parse(b.movieFile?.dateAdded) || 0) - (Date.parse(a.movieFile?.dateAdded) || 0))

  async function downloadAllMissing() {
    const missing = movies.filter(m => !m.hasFile && m.monitored && m.isAvailable)
    if (!missing.length) return
    try {
      await checkedFetch('/api/radarr/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'MoviesSearch', movieIds: missing.map(m => m.id) }),
      })
      onToast(`Searching for ${missing.length} missing movies`, 'success')
    } catch (e) {
      onToast(`Failed: ${e.message}`, 'error')
    }
  }

  return (
    <div className="movies-tab">
      {/* Stats */}
      <div className="movies-stats card">
        <div className="stat-chip">
          <span className="stat-chip-value">{movies.length}</span>
          <span className="stat-chip-label">Total Movies</span>
        </div>
        <div className="stat-chip">
          <span className="stat-chip-value text-success">{downloaded}</span>
          <span className="stat-chip-label">Downloaded</span>
        </div>
        <div className="stat-chip">
          <span className="stat-chip-value text-danger">{missing}</span>
          <span className="stat-chip-label">Missing</span>
        </div>
        {missing > 0 && (
          <button className="btn btn-success btn-sm ml-auto" onClick={downloadAllMissing}>
            ⬇ Download All Missing ({missing})
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
              className={`btn btn-sm ${filter === v ? 'btn-primary' : 'btn-secondary'}`}
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
        {['list','posters'].map(value => <button key={value} className="btn btn-secondary" aria-pressed={view === value} onClick={() => setView(value)}>{value === 'list' ? 'List' : 'Posters'}</button>)}
      </div>
      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">🎬</div>
          <span>No movies match your filter</span>
        </div>
      ) : (
        <div className={`movies-grid movies-${view}`}>
          {filtered.map(movie => (
            <MovieCard key={movie.id} movie={movie} onToast={onToast} onChanged={fetchMovies} identity={identity} />
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
