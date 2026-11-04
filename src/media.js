// Pure helpers shared by the Classic and Modern layouts.

// A series' episode counts from Sonarr's own statistics, main seasons only (season 0 / specials are left out):
//   total   every episode the series has (totalEpisodeCount)
//   onDisk  episodes with a file (episodeFileCount)
//   wanted  what Sonarr wants from the series: the monitored episodes that have aired, and any that have a file
//           (episodeCount). It is 0 when nothing is monitored, whatever the total
//   missing wanted but without a file: what Search Missing goes for, the same number the iOS app shows
//   pct     the bar's width, 0 to 100: onDisk of wanted
export function mainSeasonCounts(show) {
  const seasons = (show.seasons || []).filter(s => s.seasonNumber > 0)
  // Fallback: use show-level stats (no season breakdown available)
  const stats = seasons.length > 0 ? seasons.map(s => s.statistics || {}) : [show.statistics || {}]
  const sum = key => stats.reduce((n, s) => n + (s[key] || 0), 0)
  const total = sum('totalEpisodeCount'), onDisk = sum('episodeFileCount'), wanted = sum('episodeCount')
  return { total, onDisk, wanted, missing: Math.max(0, wanted - onDisk), pct: wanted > 0 ? Math.min(100, Math.round((onDisk / wanted) * 100)) : 0 }
}

// Colour of a show's episode bar: red under a third of what Sonarr wants, yellow under four fifths, green below
// complete and grey once all of it is on disk. 'none' when Sonarr wants nothing, so there is no bar to draw.
export function completenessTone(onDisk, wanted) {
  if (!(wanted > 0)) return 'none'
  if (onDisk >= wanted) return 'done'
  const share = onDisk / wanted
  return share < 1 / 3 ? 'low' : share < 0.8 ? 'mid' : 'high'
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

// The episodes a season's "Search N Missing" goes for: aired, without a file, and not unmonitored. An unmonitored
// episode is one the user chose not to have, so a bulk search leaves it out; this is also why the buttons of a show's
// seasons add up to the show's own "N missing", which counts what Sonarr wants. An episode without the flag counts as
// monitored (Sonarr always sends it). One episode can still be searched by hand from its own row.
export function wantedMissing(episodes, now = Date.now()) {
  return episodes.filter(ep => episodeState(ep, now) === 'missing' && ep.monitored !== false)
}

const TMDB_ORIGINAL = 'https://image.tmdb.org/t/p/original/'
const TMDB_WIDTH = { grid: 'w342', detail: 'w780', backdrop: 'w1280' }
export const isHttpUrl = value => typeof value === 'string' && /^https?:\/\//i.test(value)

// First http(s) image of a cover type; TMDB originals are rewritten to the width the view needs.
// Episode stills (size 'still') are never rewritten. `remoteUrl` is preferred; an absolute `url` is the
// remote address in answers that skip the local-cover mapping (queue and calendar on older Sonarr and Radarr).
export function artUrl(media, coverType, size) {
  const image = (media?.images || []).find(entry => entry?.coverType === coverType && (isHttpUrl(entry.remoteUrl) || isHttpUrl(entry.url)))
  if (!image) return null
  const url = isHttpUrl(image.remoteUrl) ? image.remoteUrl : image.url
  const width = TMDB_WIDTH[size]
  if (width && url.startsWith(TMDB_ORIGINAL)) return `https://image.tmdb.org/t/p/${width}/${url.slice(TMDB_ORIGINAL.length)}`
  return url
}
