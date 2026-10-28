// Pure logic for the Modern Downloads page and the live download status on other Modern surfaces:
// tidying release names, matching queue slots to Sonarr/Radarr records, matching history by name,
// status, quality line and formatting. No React and no clock of its own: callers pass the time.
import { artUrl } from './media'

// ---- Names ----------------------------------------------------------------------------------

export const normalise = value => String(value ?? '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '')

const CATEGORIES = {
  tv: ['TV', 'television-simple'], movies: ['Movie', 'film-slate'], music: ['Music', 'music-notes'], audio: ['Music', 'music-notes'],
  books: ['Book', 'book-open'], ebooks: ['Book', 'book-open'], software: ['Software', 'package'], apps: ['Software', 'package'],
}
export function categoryInfo(category) {
  const key = String(category ?? '').trim().toLowerCase()
  if (CATEGORIES[key]) return { label: CATEGORIES[key][0], icon: CATEGORIES[key][1] }
  const named = key && key !== '*' ? String(category).trim() : ''
  return { label: named ? named.charAt(0).toUpperCase() + named.slice(1) : 'Download', icon: 'file' }
}

const TECHNICAL = new Set(('2160p 1080p 720p 576p 480p 4k uhd web web-dl webdl webrip bluray blu-ray bdrip brrip dvdrip hdtv remux hdr hdr10 hdr10+ hlg dv dovi '
  + 'hevc avc h264 h265 x264 x265 xvid dd ddp ddp5 dd5 aac ac3 dts truehd atmos flac mp3 24bit 16bit epub mobi pdf proper repack internal multi '
  + 'atvp amzn nf dsnp hmax hulu ip nzb').split(' '))
const isMarker = token => /^S\d{1,2}(E\d{1,3})?$/i.test(token) || /^S\d{1,2}E\d{1,3}/i.test(token) || /^(19|20)\d\d$/.test(token) || TECHNICAL.has(token.toLowerCase())

function tokenize(raw) {
  const name = String(raw ?? '').replace(/\.nzb$/i, '')
  return (/\s/.test(name) ? name.split(/\s+/) : name.split(/[._]/)).filter(Boolean)
}

// D13: the readable part of a release name, cut at the first season/episode marker, year or technical token.
export function tidyName(raw) {
  const original = String(raw ?? '')
  const tokens = tokenize(original)
  let kept = null
  for (let i = 0; i < tokens.length && kept === null; i++) {
    if (i > 0 && isMarker(tokens[i])) { kept = tokens.slice(0, i); break }
    const segments = tokens[i].split('-')
    for (let k = i === 0 ? 1 : 0; k < segments.length; k++) {
      if (!isMarker(segments[k])) continue
      kept = k === 0 ? tokens.slice(0, i) : [...tokens.slice(0, i), segments.slice(0, k).join('-')]
      break
    }
  }
  if (kept === null) {
    if (!tokens.length || TECHNICAL.has(tokens[0].toLowerCase())) return original
    kept = tokens.filter(token => !TECHNICAL.has(token.toLowerCase()))
  }
  const tidy = kept.join(' ').trim().replace(/[\s-]+$/, '')
  return tidy || original
}

const SEASON_EPISODE = /(?:^|[^a-z0-9])S(\d{1,2})E(\d{1,3})(?![0-9])/i
// A season pack: S03, or a run of seasons such as S01-S03, with no episode number after it.
const SEASON_ONLY = /(?:^|[^a-z0-9])S(\d{1,2})(?:-S?(\d{1,2}))?(?![a-z0-9])/i
// Tokens are bounded by non-alphanumerics. No lookbehind: older iPhones' Safari rejects it and would break the whole bundle.
const RESOLUTION = /(?:^|[^a-z0-9])(2160|1080|720|576|480)p(?![a-z0-9])/i
const resolutionText = value => { const m = RESOLUTION.exec(value || ''); return m ? (m[1] === '2160' ? '4K' : `${m[1]}p`) : null }
const FLAGS = [
  ['Dolby Vision', /(?:^|[^a-z0-9])(?:dv|dovi)(?![a-z0-9])|dolby[ ._-]?vision/i],
  ['HDR', /(?:^|[^a-z0-9])hdr(?:10\+?)?(?![a-z0-9])/i],
  ['HLG', /(?:^|[^a-z0-9])hlg(?![a-z0-9])/i],
  ['Atmos', /(?:^|[^a-z0-9])atmos(?![a-z0-9])/i],
  ['Remux', /(?:^|[^a-z0-9])remux(?![a-z0-9])/i],
  ['FLAC', /(?:^|[^a-z0-9])flac(?![a-z0-9])/i],
  ['24-bit', /(?:^|[^a-z0-9])24[ ._-]?bit(?![a-z0-9])/i],
]
const flagsIn = text => FLAGS.filter(([, pattern]) => pattern.test(text)).map(([label]) => label)

// What a release name says about itself: { season, episode, year, resolution, flags }. A season pack has a
// season and a null episode.
export function parseRelease(raw) {
  const name = String(raw ?? '')
  const se = SEASON_EPISODE.exec(name)
  const pack = se ? null : SEASON_ONLY.exec(name)
  let year = null
  tokenize(name).forEach((token, i) => token.split('-').forEach((segment, k) => {
    if (year === null && !(i === 0 && k === 0) && /^(19|20)\d\d$/.test(segment)) year = Number(segment)
  }))
  return { season: se ? Number(se[1]) : pack ? Number(pack[1]) : null, episode: se ? Number(se[2]) : null, year, resolution: resolutionText(name), flags: flagsIn(name) }
}

// D18: "4K · Dolby Vision · HDR · Atmos". The matched record's quality name wins for the resolution.
export function qualityLine({ qualityName, release } = {}) {
  const quality = qualityName ? String(qualityName) : ''
  const resolution = quality ? (resolutionText(quality) || quality) : resolutionText(release)
  return [resolution, ...flagsIn(`${release || ''} ${quality}`)].filter(Boolean).join(' · ')
}

// ---- Status -----------------------------------------------------------------------------------

const KIND_LABEL = { downloading: 'Downloading', paused: 'Paused', queued: 'Queued', processing: 'Processing' }
export function statusKind(slot) {
  const status = slot?.status
  if (status === 'Downloading' || status === 'Fetching' || status === 'Grabbing') return 'downloading'
  if (status === 'Paused') return 'paused'
  if (status === 'Queued' || status === 'Propagating' || status === 'Idle') return 'queued'
  return 'processing'
}
export const kindLabel = kind => KIND_LABEL[kind]

// The first downloading slot, else the first slot, else null (D11).
export function leadItem(items) { return items.find(item => item.status === 'downloading') || items[0] || null }
// The pill shows the first downloading item only (D26).
export function pillItem(items) { return items.find(item => item.status === 'downloading') || null }

// Row status line (D17): text, tone, and whether a bar shows.
export function rowStatus(kind, pct) {
  if (kind === 'paused') return { text: `Paused · ${pct}%`, tone: 'attn', bar: true }
  if (kind === 'downloading' && pct > 0) return { text: `${pct}%`, tone: 'live', bar: true }
  if (kind === 'processing') return { text: 'Processing', tone: 'live', bar: true }
  return { text: 'Queued', tone: 'muted', bar: false }
}
// Status shown on show episodes and movie surfaces (D27, D28).
export function liveStatus(item) {
  const { status: kind, pct } = item
  const label = KIND_LABEL[kind]
  const left = kind === 'downloading' ? formatLeft(item.slot?.timeleft) : null
  return {
    kind, pct, label,
    tone: kind === 'downloading' ? 'live' : kind === 'paused' ? 'attn' : 'muted',
    tileText: kind === 'downloading' || kind === 'paused' ? `${label} · ${pct}%` : label,
    detail: kind === 'downloading' ? [`${pct}%`, left].filter(Boolean).join(' · ') : kind === 'paused' ? `${pct}%` : null,
  }
}

// ---- Formatting -------------------------------------------------------------------------------

export function formatSize(mb) {
  const value = parseFloat(mb)
  if (mb == null || !Number.isFinite(value)) return '—'
  return value >= 1024 ? `${(value / 1024).toFixed(1)} GB` : `${value.toFixed(0)} MB`
}
export function formatSpeed(kbps) {
  const value = parseFloat(kbps)
  if (!kbps || !Number.isFinite(value) || value <= 0) return '—'
  return value >= 1024 ? `${(value / 1024).toFixed(1)} MB/s` : `${value.toFixed(0)} KB/s`
}
export function percentOf(slot) {
  return Math.min(100, Math.max(0, Math.floor(parseFloat(slot?.percentage) || 0)))
}
// H:MM:SS or D:HH:MM:SS from SABnzbd; null when unknown or finished.
export function formatLeft(timeleft) {
  if (typeof timeleft !== 'string' || !/^\d+(:\d{1,2}){2,3}$/.test(timeleft.trim())) return null
  const parts = timeleft.trim().split(':').map(Number)
  const [days, hours, minutes, seconds] = parts.length === 4 ? parts : [0, ...parts]
  const total = ((days * 24 + hours) * 60 + minutes) * 60 + seconds
  if (!(total > 0)) return null
  if (total < 90) return '1 min left'
  if (total < 3600) return `${Math.round(total / 60)} min left`
  let h = Math.floor(total / 3600)
  let m = Math.round((total % 3600) / 60)
  if (m === 60) { h += 1; m = 0 }
  return m ? `${h} hr ${m} min left` : `${h} hr left`
}

const dayNumber = date => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000
// `completed` is Unix seconds; the text depends only on the arguments (D14).
export function relativeTime(completedSeconds, now) {
  const completed = Number(completedSeconds)
  if (!Number.isFinite(completed) || completed <= 0) return null
  const then = new Date(completed * 1000)
  const diff = now - then.getTime()
  if (diff < 60000) return 'Just now'
  if (diff < 3600000) return `${Math.floor(diff / 60000)} min ago`
  const days = dayNumber(new Date(now)) - dayNumber(then)
  if (days <= 0) return `${Math.floor(diff / 3600000)} hr ago`
  if (days === 1) return 'Yesterday'
  if (days <= 6) return `${days} days ago`
  const sameYear = then.getFullYear() === new Date(now).getFullYear()
  return then.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) })
}

// ---- Packs ------------------------------------------------------------------------------------

// D3: the subtitle of one or more episodes of one series: { hero, row }.
export function episodeSummary(episodes) {
  const list = (episodes || []).filter(Boolean)
    .sort((a, b) => (a.seasonNumber - b.seasonNumber) || (a.episodeNumber - b.episodeNumber))
  if (!list.length) return { hero: '', row: '' }
  if (list.length === 1) {
    const [ep] = list
    const title = ep.title ? ` · ${ep.title}` : ''
    return { hero: `Season ${ep.seasonNumber}, Episode ${ep.episodeNumber}${title}`, row: `S${ep.seasonNumber} E${ep.episodeNumber}${title}` }
  }
  const seasons = [...new Set(list.map(ep => ep.seasonNumber))]
  if (seasons.length > 1) {
    return { hero: `Seasons ${seasons.join(', ')} · ${list.length} episodes`, row: `${seasons.map(s => `S${s}`).join(', ')} · ${list.length} episodes` }
  }
  const numbers = list.map(ep => ep.episodeNumber)
  const low = Math.min(...numbers), high = Math.max(...numbers)
  if (new Set(numbers).size === list.length && high - low + 1 === list.length) {
    return { hero: `Season ${seasons[0]}, Episodes ${low}–${high}`, row: `S${seasons[0]} · Episodes ${low}–${high}` }
  }
  return { hero: `Season ${seasons[0]} · ${list.length} episodes`, row: `S${seasons[0]} · ${list.length} episodes` }
}

// ---- Hints and subtitles for unmatched items ----------------------------------------------------

const MOVIE_SHAPE = /^(.+?)[._ -]+((?:19|20)\d\d)(?:[._ -]|$)/
// D16: wording only, never a claim. `ok` says which arr services answered (and, for history, loaded their library).
export function hintFor(raw, category, ok = {}) {
  const release = parseRelease(raw)
  if (release.season !== null && ok.sonarr) return 'Not in Sonarr'
  if (MOVIE_SHAPE.test(String(raw ?? '')) && String(category ?? '').toLowerCase() === 'movies' && ok.radarr) return 'Not in Radarr'
  return null
}
// D15: category label, then S2 E5 (S2 for a season pack) or the year.
export function unmatchedSubtitle(raw, category) {
  const release = parseRelease(raw)
  const marker = release.season !== null ? (release.episode !== null ? `S${release.season} E${release.episode}` : `S${release.season}`) : release.year
  return [categoryInfo(category).label, marker].filter(value => value !== null && value !== undefined && value !== '').join(' · ')
}

// ---- Queue ------------------------------------------------------------------------------------

const arts = media => ({ fanart: artUrl(media, 'fanart', 'backdrop'), poster: artUrl(media, 'poster', 'detail'), thumb: artUrl(media, 'poster', 'grid') })

// D2: Map<downloadId, record[]> from records whose downloadId is a non-empty string.
function recordsById(records) {
  const map = new Map()
  for (const record of records || []) {
    if (typeof record?.downloadId !== 'string' || record.downloadId === '') continue
    if (!map.has(record.downloadId)) map.set(record.downloadId, [])
    map.get(record.downloadId).push(record)
  }
  return map
}
// A service matches when it answered, or when it failed after an earlier answer whose records the store kept (D10).
const usable = arr => Boolean(arr) && (arr.state === 'ok' || (arr.state === 'error' && arr.kept === true))

// slots: SABnzbd queue slots. arr: { sonarr: { state, records, kept }, radarr: { ... } }.
export function buildQueueItems(slots, arr = {}) {
  const sonarr = usable(arr.sonarr) ? recordsById(arr.sonarr.records) : new Map()
  const radarr = usable(arr.radarr) ? recordsById(arr.radarr.records) : new Map()
  const hints = { sonarr: arr.sonarr?.state === 'ok', radarr: arr.radarr?.state === 'ok' }
  return (slots || []).map(slot => {
    const base = { key: slot.nzo_id, slot, release: slot.filename || slot.name || '', status: statusKind(slot), pct: percentOf(slot) }
    const tv = sonarr.get(slot.nzo_id)
    const film = tv ? null : radarr.get(slot.nzo_id)
    if (tv) {
      const withSeries = tv.find(record => record.series) || tv[0]
      const series = withSeries.series || null
      const seriesId = withSeries.seriesId ?? series?.id ?? null
      const episodes = tv.filter(record => record.series?.id === series?.id || !record.series).map(record => record.episode).filter(Boolean)
      const summary = episodeSummary(episodes)
      return { ...base, kind: 'tv', matched: true, service: 'sonarr', media: series, mediaId: seriesId, title: series?.title || tidyName(base.release),
        heroSubtitle: summary.hero, subtitle: summary.row, hint: null, category: categoryInfo('tv'), art: arts(series),
        quality: qualityLine({ qualityName: withSeries.quality?.name, release: base.release }),
        episodeIds: tv.map(record => record.episodeId ?? record.episode?.id).filter(id => id !== null && id !== undefined) }
    }
    if (film) {
      const record = film[0]
      const movie = record.movie || null
      const sub = [movie?.year, 'Movie'].filter(Boolean).join(' · ')
      return { ...base, kind: 'movie', matched: true, service: 'radarr', media: movie, mediaId: record.movieId ?? movie?.id ?? null,
        title: movie?.title || tidyName(base.release), heroSubtitle: sub, subtitle: sub, hint: null, category: categoryInfo('movies'), art: arts(movie),
        quality: qualityLine({ qualityName: record.quality?.name, release: base.release }), episodeIds: [] }
    }
    const subtitle = unmatchedSubtitle(base.release, slot.cat)
    return { ...base, kind: 'unmatched', matched: false, service: null, media: null, mediaId: null, title: tidyName(base.release),
      heroSubtitle: subtitle, subtitle, hint: hintFor(base.release, slot.cat, hints), category: categoryInfo(slot.cat),
      art: { fanart: null, poster: null, thumb: null }, quality: qualityLine({ release: base.release }), episodeIds: [] }
  })
}

// ---- History ----------------------------------------------------------------------------------

const TV_SHAPE = /^(.+?)[._ -]+S(\d{1,2})E(\d{1,3})/i
// Season packs: the title, then S03 or S01-S03 with no episode number.
const PACK_SHAPE = /^(.+?)[._ -]+S(\d{1,2})(?:-S?(\d{1,2}))?(?=[._ -]|$)/i
const TRAILING_YEAR = /^(.+?)[._ -]+\(?((?:19|20)\d\d)\)?$/
// Sonarr names a show that shares its title with another one "Tracker (2024)"; releases usually leave the year out.
const TITLE_YEAR = /\s*\((?:19|20)\d\d\)\s*$/

// The one series a release's title part names, or null when none or several do. An exact title match wins;
// only without one is a title with its "(2024)" suffix removed compared.
function findSeries(titlePart, series) {
  const full = normalise(titlePart)
  if (!full) return null
  const dated = TRAILING_YEAR.exec(titlePart)
  const year = dated ? Number(dated[2]) : null
  const stripped = dated ? normalise(dated[1]) : null
  const named = title => title === full || (stripped !== null && title === stripped)
  const candidates = series.filter(show => year === null || Number(show.year) === year)
  const exact = candidates.filter(show => named(normalise(show.title)))
  const found = exact.length ? exact : candidates.filter(show => named(normalise(String(show.title ?? '').replace(TITLE_YEAR, ''))))
  return found.length === 1 ? found[0] : null
}

// D5: { kind: 'tv', series, season, number, lastSeason } | { kind: 'movie', movie } | null. A season pack has a
// null number (and lastSeason for a run of seasons). A list that is null is not loaded.
export function matchHistory(name, { series = null, movies = null } = {}) {
  const raw = String(name ?? '')
  const tv = TV_SHAPE.exec(raw)
  const pack = tv ? null : PACK_SHAPE.exec(raw)
  if (tv || pack) {
    if (!Array.isArray(series)) return null
    const show = findSeries((tv || pack)[1], series)
    if (!show) return null
    if (tv) return { kind: 'tv', series: show, season: Number(tv[2]), number: Number(tv[3]), lastSeason: null }
    const first = Number(pack[2]), last = pack[3] === undefined ? first : Number(pack[3])
    return { kind: 'tv', series: show, season: first, number: null, lastSeason: last > first ? last : null }
  }
  const film = MOVIE_SHAPE.exec(raw)
  if (film) {
    if (!Array.isArray(movies)) return null
    const title = normalise(film[1])
    const found = movies.filter(movie => normalise(movie.title) === title && Number(movie.year) === Number(film[2]))
    return found.length === 1 ? { kind: 'movie', movie: found[0] } : null
  }
  return null
}

// libraries: { series, movies } (null = not loaded); hints: { sonarr, radarr } = service answered.
export function buildHistoryItems(slots, libraries = {}, hints = {}) {
  const ok = { sonarr: Boolean(hints.sonarr) && Array.isArray(libraries.series), radarr: Boolean(hints.radarr) && Array.isArray(libraries.movies) }
  return (slots || []).map((slot, index) => {
    const release = slot.name || ''
    const category = slot.category ?? slot.cat
    const match = matchHistory(release, libraries)
    const mb = slot.bytes != null && Number.isFinite(Number(slot.bytes)) ? Number(slot.bytes) / 1048576 : slot.mb
    const base = { key: slot.nzo_id || `h${index}`, slot, release, status: slot.status, completed: Number(slot.completed) || 0,
      size: formatSize(mb), quality: qualityLine({ release }) }
    if (match?.kind === 'tv') {
      const subtitle = match.number !== null ? `S${match.season} E${match.number}`
        : match.lastSeason !== null ? `Seasons ${match.season}–${match.lastSeason}` : `Season ${match.season}`
      return { ...base, kind: 'tv', matched: true, media: match.series, mediaId: match.series.id, title: match.series.title,
        subtitle, hint: null, category: categoryInfo('tv'), art: arts(match.series) }
    }
    if (match?.kind === 'movie') {
      return { ...base, kind: 'movie', matched: true, media: match.movie, mediaId: match.movie.id, title: match.movie.title,
        subtitle: [match.movie.year, 'Movie'].filter(Boolean).join(' · '), hint: null, category: categoryInfo('movies'), art: arts(match.movie) }
    }
    return { ...base, kind: 'unmatched', matched: false, media: null, mediaId: null, title: tidyName(release),
      subtitle: unmatchedSubtitle(release, category), hint: hintFor(release, category, ok), category: categoryInfo(category),
      art: { fanart: null, poster: null, thumb: null } }
  })
}

// D24: the newest Completed, matched history item that has fanart or a poster.
export function idleLead(items) {
  return items.filter(item => item.status === 'Completed' && item.matched && (item.art.fanart || item.art.poster))
    .reduce((best, item) => (!best || item.completed > best.completed ? item : best), null)
}
