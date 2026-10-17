import Icon from '../Icon.jsx'
import ArtImage from './ArtImage.jsx'
import NotFound from './NotFound.jsx'
import MovieActions from './MovieActions.jsx'
import { SettingsLink } from './PageHeader.jsx'
import { useMovies } from './LibraryProvider.jsx'
import { useMediaActions } from '../../hooks/useMediaActions'
import { artUrl, futureReleases, releaseLabel, movieFileLine, getMovieStatus, MOVIE_STATUS } from '../../media'

const goToMovies = () => { window.location.hash = '/movies' }

// File line / Missing / Unmonitored / release dates (D23).
function statusLine(movie, now = Date.now()) {
  if (movie.hasFile) return { text: movieFileLine(movie) ? `File: ${movieFileLine(movie)}` : 'Downloaded', attn: false }
  if (!movie.monitored) return { text: 'Unmonitored', attn: false }
  if (movie.isAvailable) return { text: 'Missing', attn: true }
  const dates = futureReleases(movie, now)
  return { text: dates.length ? dates.map(release => releaseLabel(release, now)).join(' · ') : (MOVIE_STATUS[getMovieStatus(movie)]?.label || getMovieStatus(movie)), attn: false }
}

export default function MoviePage({ id, phone, onToast }) {
  const { movies, loading, error, refresh, identity } = useMovies()
  const actions = useMediaActions(onToast)
  const numeric = /^\d+$/.test(id) ? Number(id) : NaN
  if (!Number.isSafeInteger(numeric)) return <NotFound kind="movie" />
  if (loading) return <div className="empty-state" role="status"><h1 className="m-sr" data-m-placeholder>Movie</h1><span className="spinner" /><span>Loading movie…</span></div>
  if (error) return <div className="empty-state">
    <h1 className="m-sr">Movie</h1>
    <div className="empty-state-icon"><Icon name="warning" /></div>
    <strong>Cannot reach Radarr</strong>
    <p className="text-sm text-muted">{error}</p>
    <button className="btn btn-secondary mt-4" onClick={refresh}>Retry</button>
  </div>
  const movie = movies.find(m => m.id === numeric)
  if (!movie) return <NotFound kind="movie" />
  const status = statusLine(movie)
  const meta = [movie.year, movie.studio].filter(Boolean).join(' · ')
  return <article className="m-detail m-movie">
    <ArtImage ambient srcs={[artUrl(movie, 'fanart', 'backdrop'), artUrl(movie, 'poster', 'detail')]} />
    <section className="m-hero">
      <div className="m-hero-nav">
        <a className="m-back" href="#/movies" aria-label="Back to Movies"><Icon name="caret-left" /><span>Movies</span></a>
        {phone && <SettingsLink className="m-iconbtn m-roundbtn" />}
      </div>
      <div className="m-movie-poster">
        <ArtImage srcs={[artUrl(movie, 'poster', 'detail')]} className="m-art-poster" width="300" height="450" eager />
      </div>
      <div className="m-hero-body">
        <h1>{movie.title}</h1>
        {meta && <p className="m-hero-meta">{meta}</p>}
        {movie.overview && <p className="m-overview">{movie.overview}</p>}
        <p className={`m-statusline${status.attn ? ' m-attn' : ''}`}>{status.text}</p>
        <div className="m-hero-actions">
          <MovieActions movie={movie} actions={actions} identity={identity} onChanged={refresh} onToast={onToast} onRemoved={goToMovies} variant="page" />
        </div>
      </div>
    </section>
  </article>
}
