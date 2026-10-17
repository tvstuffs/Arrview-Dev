// Pure helpers shared by the Classic and Modern layouts.

// Sum episode counts from main seasons only (exclude season 0 / specials)
export function mainSeasonCounts(show) {
  const seasons = (show.seasons || []).filter(s => s.seasonNumber > 0)
  if (seasons.length > 0) {
    const total  = seasons.reduce((n, s) => n + (s.statistics?.totalEpisodeCount || 0), 0)
    const onDisk = seasons.reduce((n, s) => n + (s.statistics?.episodeFileCount  || 0), 0)
    return { total, onDisk }
  }
  // Fallback: use show-level stats (no season breakdown available)
  const stats = show.statistics || {}
  return { total: stats.totalEpisodeCount || 0, onDisk: stats.episodeFileCount || 0 }
}

export const MOVIE_STATUS = {
  available:    { label: 'Downloaded',   cls: 'badge-success' },
  missing:      { label: 'Missing',      cls: 'badge-warning' },
  announced:    { label: 'Announced',    cls: 'badge-muted'   },
  inCinemas:    { label: 'In Cinemas',   cls: 'badge-muted'   },
  released:     { label: 'Released',     cls: 'badge-muted'   },
}

export function getMovieStatus(movie) {
  if (movie.hasFile) return 'available'
  if (!movie.isAvailable) return movie.status || 'announced'
  return 'missing'
}

export function isMovieMissing(movie) {
  return Boolean(!movie.hasFile && movie.monitored && movie.isAvailable)
}

// Earliest future digital or physical release (digital wins a tie), or null.
export function futureReleases(movie, now = Date.now()) {
  const out = []
  for (const [kind, value] of [['Digital', movie.digitalRelease], ['Physical', movie.physicalRelease]]) {
    const time = Date.parse(value)
    if (Number.isFinite(time) && time > now) out.push({ kind, date: new Date(value), time })
  }
  return out.sort((a, b) => a.time - b.time)
}
export function nextRelease(movie, now = Date.now()) {
  return futureReleases(movie, now)[0] || null
}
export function releaseDateText(date, now = Date.now()) {
  const sameYear = date.getFullYear() === new Date(now).getFullYear()
  return date.toLocaleDateString(undefined, sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' })
}
export function releaseLabel(release, now = Date.now()) {
  return `${release.kind} ${releaseDateText(release.date, now)}`
}

// Identical expression and fallbacks to the Classic file line.
export function movieFileLine(movie) {
  if (!movie.hasFile || !movie.movieFile) return null
  return `${movie.movieFile.quality?.quality?.name || 'Downloaded'} · ${movie.movieFile.size != null ? `${(movie.movieFile.size / 1073741824).toFixed(1)} GB` : 'Size unknown'} · ${movie.movieFile.mediaInfo?.resolution || movie.movieFile.quality?.quality?.resolution || 'Resolution unknown'} · ${movie.movieFile.languages?.map(l => l.name).join(', ') || movie.movieFile.mediaInfo?.audioLanguages || 'Languages unknown'}`
}

export function episodeState(ep, now = Date.now()) {
  if (ep.hasFile) return 'downloaded'
  const aired = ep.airDateUtc ? Date.parse(ep.airDateUtc) : NaN
  return Number.isFinite(aired) && aired < now ? 'missing' : 'upcoming'
}

const TMDB_ORIGINAL = 'https://image.tmdb.org/t/p/original/'
const TMDB_WIDTH = { grid: 'w342', detail: 'w780', backdrop: 'w1280' }
// First http(s) image of a cover type; TMDB originals are rewritten to the width the view needs.
// Episode stills (size 'still') are never rewritten.
export function artUrl(media, coverType, size) {
  const image = (media?.images || []).find(entry => entry?.coverType === coverType && typeof entry.remoteUrl === 'string' && /^https?:\/\//i.test(entry.remoteUrl))
  if (!image) return null
  const url = image.remoteUrl
  const width = TMDB_WIDTH[size]
  if (width && url.startsWith(TMDB_ORIGINAL)) return `https://image.tmdb.org/t/p/${width}/${url.slice(TMDB_ORIGINAL.length)}`
  return url
}
