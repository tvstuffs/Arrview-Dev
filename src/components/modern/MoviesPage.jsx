import { useState } from 'react'
import Icon from '../Icon.jsx'
import AddMediaModal from '../AddMediaModal.jsx'
import PageHeader from './PageHeader.jsx'
import ViewToggle, { VIEW_VALUES } from './ViewToggle.jsx'
import FilterChips from './FilterChips.jsx'
import ArtImage from './ArtImage.jsx'
import MovieActions, { useHoverCapable } from './MovieActions.jsx'
import { useMovies } from './LibraryProvider.jsx'
import { useMediaActions } from '../../hooks/useMediaActions'
import { usePreference, textPreference, oneOf } from '../../hooks/usePreference'
import { artUrl, isMovieMissing, nextRelease, releaseLabel, getMovieStatus, MOVIE_STATUS } from '../../media'

const FILTERS = [['all', 'All'], ['downloaded', 'Downloaded'], ['missing', 'Missing'], ['monitored', 'Monitored']]
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

// Tile and row meta (D16/D17): { text, attn }. Unmonitored wins over missing.
export function movieMeta(movie, now = Date.now()) {
  if (movie.hasFile) return { text: [movie.year, movie.studio].filter(Boolean).join(' · '), attn: false, grey: false }
  if (!movie.monitored) return { text: 'Unmonitored', attn: false, grey: true }
  if (!movie.isAvailable) {
    const release = nextRelease(movie, now)
    return { text: release ? releaseLabel(release, now) : (MOVIE_STATUS[getMovieStatus(movie)]?.label || getMovieStatus(movie)), attn: false, grey: false }
  }
  return { text: 'Missing', attn: true, grey: true }
}

function MovieTile({ movie, small, hover, ...rest }) {
  const meta = movieMeta(movie)
  const metaId = `movie-meta-${movie.id}`
  return <li className="m-tilewrap">
    <a className="m-tile" href={`#/movies/${movie.id}`} aria-label={movie.title} title={small ? movie.title : undefined} aria-describedby={small ? undefined : metaId}>
      <span className={`m-poster${meta.grey ? ' is-grey' : ''}`}>
        <ArtImage srcs={[artUrl(movie, 'poster', 'grid')]} className="m-art-poster" width="200" height="300" />
      </span>
      {!small && <>
        <span className="m-tile-title">{movie.title}</span>
        <span className={`m-tile-meta${meta.attn ? ' is-attn' : ''}`} id={metaId}>{meta.text}</span>
      </>}
    </a>
    {hover && <div className="m-overlay"><MovieActions movie={movie} variant={small ? 'overlay-small' : 'overlay'} {...rest} /></div>}
  </li>
}

function MovieRow({ movie, ...rest }) {
  const meta = movieMeta(movie)
  const studio = [movie.year, movie.studio].filter(Boolean).join(' · ')
  return <li className="m-row">
    <a className="m-row-link" href={`#/movies/${movie.id}`}>
      <ArtImage srcs={[artUrl(movie, 'poster', 'grid')]} className={`m-art-poster m-thumb${meta.grey ? ' is-grey' : ''}`} width="64" height="96" />
      <span className="m-row-text">
        <span className="m-row-title">{movie.title}</span>
        {studio && <span className="m-row-meta">{studio}</span>}
        <span className={`m-row-meta${meta.attn ? ' m-attn' : ''}`}>{movie.hasFile ? 'Downloaded' : meta.text}</span>
      </span>
    </a>
    <div className="m-row-actions"><MovieActions movie={movie} variant="row" {...rest} /></div>
  </li>
}

const goToMovies = () => { window.location.hash = '/movies' }

export default function MoviesPage({ phone, onToast }) {
  const { movies, loading, error, refresh, identity } = useMovies()
  const [search, setSearch] = usePreference('movies.search', '', textPreference)
  const [filter, setFilter] = usePreference('movies.filter', 'all', oneOf(FILTERS.map(([v]) => v)))
  const [sort, setSort] = usePreference('movies.sort', 'alpha', oneOf(['alpha', 'year', 'added', 'downloaded']))
  const [view, setView] = usePreference('movies.view', 'posters', oneOf(VIEW_VALUES))
  const [adding, setAdding] = useState(false)
  const actions = useMediaActions(onToast)
  const hover = useHoverCapable()

  let body
  if (loading) body = <div className="empty-state" role="status"><span className="spinner" /><span>Loading movies…</span></div>
  else if (error) body = <div className="empty-state">
    <div className="empty-state-icon"><Icon name="warning" /></div>
    <strong>Cannot reach Radarr</strong>
    <p className="text-sm text-muted">{error}</p>
    <button className="btn btn-secondary mt-4" onClick={refresh}>Retry</button>
  </div>
  else {
    const missing = movies.filter(isMovieMissing).length
    const filtered = movies.filter(m => {
      if (search && !m.title.toLowerCase().includes(search.toLowerCase())) return false
      if (filter === 'downloaded') return m.hasFile
      if (filter === 'missing') return isMovieMissing(m)
      if (filter === 'monitored') return m.monitored && !m.hasFile
      return true
    })
    if (sort === 'alpha') filtered.sort((a, b) => a.title.localeCompare(b.title))
    else if (sort === 'year') filtered.sort((a, b) => (b.year || 0) - (a.year || 0))
    else if (sort === 'added') filtered.sort((a, b) => new Date(b.added) - new Date(a.added))
    else if (sort === 'downloaded') filtered.sort((a, b) => (Date.parse(b.movieFile?.dateAdded) || 0) - (Date.parse(a.movieFile?.dateAdded) || 0))
    const shared = { actions, identity, onChanged: refresh, onToast, onRemoved: goToMovies }
    body = <>
      <p className="m-meta">
        <span>{plural(movies.length, 'movie', 'movies')}</span>
        {missing > 0 && <> <span aria-hidden="true">·</span> <span className="m-attn">{missing} missing</span></>}
      </p>
      <div className="m-controls">
        <div className="m-search">
          <Icon name="magnifying-glass" />
          <input type="text" aria-label="Search movies" placeholder="Search movies…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <FilterChips options={FILTERS} value={filter} onChange={setFilter} />
        <select className="m-select" aria-label="Sort results" value={sort} onChange={e => setSort(e.target.value)}>
          <option value="alpha">A–Z</option>
          <option value="year">Newest First</option>
          <option value="added">Recently Added</option>
          <option value="downloaded">Recently Downloaded</option>
        </select>
        {missing > 0 && <button className="m-quiet-attn" onClick={() => actions.downloadAllMissing(movies)}>
          <Icon name="download-simple" /> Download All Missing ({missing})
        </button>}
        <ViewToggle value={view} onChange={setView} />
      </div>
      {filtered.length === 0
        ? <div className="empty-state">
          <div className="empty-state-icon"><Icon name="film-slate" /></div>
          <span>No movies match your filter</span>
        </div>
        : view === 'list'
          ? <ul className="m-list">{filtered.map(movie => <MovieRow key={movie.id} movie={movie} {...shared} />)}</ul>
          : <ul className={`m-grid ${view === 'small' ? 'is-small' : 'is-large'}`}>{filtered.map(movie => <MovieTile key={movie.id} movie={movie} small={view === 'small'} hover={hover} {...shared} />)}</ul>}
    </>
  }
  return <div className="m-page">
    <PageHeader title="Movies" phone={phone} addLabel="Add Movie" onAdd={() => setAdding(true)} gear />
    {body}
    {adding && <AddMediaModal type="movie" onClose={() => setAdding(false)} onAdded={refresh} onToast={onToast} />}
  </div>
}
