// Pure logic for Upcoming (shared by Classic, Modern and, later, the idle Downloads list).
// Episodes are keyed by their instant (local day); Radarr releases are calendar dates (the UTC date part).

const pad = n => String(n).padStart(2, '0')
const localDay = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
const utcDay = date => `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
const toDate = now => (now instanceof Date ? new Date(now) : new Date(now ?? Date.now()))

// Sonarr window: local yesterday 00:00 through +14 days 23:59:59.999.
export function calendarRange(now = new Date()) {
  const start = toDate(now), end = toDate(now)
  start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - 1)
  end.setHours(23, 59, 59, 999); end.setDate(end.getDate() + 14)
  return { start: start.toISOString(), end: end.toISOString() }
}

// Radarr window (D2): the request is padded by one calendar day each side so a release dated on either edge
// is returned whatever the zone; the client then keeps only firstDay..lastDay by UTC date part.
export function radarrWindow(now = new Date()) {
  const first = toDate(now), last = toDate(now), start = toDate(now), end = toDate(now)
  first.setDate(first.getDate() - 1)
  last.setDate(last.getDate() + 14)
  start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - 2)
  end.setHours(23, 59, 59, 999); end.setDate(end.getDate() + 15)
  return { start: start.toISOString(), end: end.toISOString(), firstDay: localDay(first), lastDay: localDay(last) }
}

export function dayDate(dayKey) {
  const [y, m, d] = dayKey.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function episodeStatus(episode, now = Date.now()) {
  return episode.hasFile ? 'Downloaded' : Date.parse(episode.airDateUtc) <= now ? 'Missing' : 'Upcoming'
}

const seriesIdOf = ep => ep.seriesId ?? ep.series?.id ?? null
const seasonOf = ep => (Number.isFinite(ep.seasonNumber) ? ep.seasonNumber : 0)
const numberOf = ep => (Number.isFinite(ep.episodeNumber) ? ep.episodeNumber : 0)
const byEpisode = (a, b) => seasonOf(a) - seasonOf(b) || numberOf(a) - numberOf(b)

function groupTitle(group) {
  const seasons = [...new Set(group.map(seasonOf))].sort((a, b) => a - b)
  if (seasons.length > 1) return `${seasons.map(s => `S${s}`).join(', ')} · ${group.length} episodes`
  const numbers = group.map(numberOf)
  const min = Math.min(...numbers), max = Math.max(...numbers)
  if (new Set(numbers).size === numbers.length && max - min + 1 === numbers.length) return `S${seasons[0]} · Episodes ${min}–${max}`
  return `S${seasons[0]} · ${group.length} episodes`
}

function episodeStatusOf(group, at, now) {
  const done = group.filter(ep => ep.hasFile).length
  if (done === group.length) return { status: 'downloaded', done }
  if (at <= now) return { status: done > 0 ? 'partial' : 'missing', done }
  return { status: null, done }
}

// Episodes of one series that air at the same instant become one entry (D5).
export function collapse(episodes, now = Date.now()) {
  const groups = new Map()
  for (const ep of episodes || []) {
    const at = Date.parse(ep?.airDateUtc)
    if (!Number.isFinite(at)) continue
    const seriesId = seriesIdOf(ep)
    const key = seriesId === null ? `episode-${ep.id}` : `${seriesId}@${at}`
    if (!groups.has(key)) groups.set(key, { at, seriesId, episodes: [] })
    groups.get(key).episodes.push(ep)
  }
  const entries = []
  for (const { at, seriesId, episodes: group } of groups.values()) {
    group.sort(byEpisode)
    const first = group[0]
    const seasons = [...new Set(group.map(seasonOf))].sort((a, b) => a - b)
    const { status, done } = episodeStatusOf(group, at, now)
    const single = group.length === 1
    entries.push({
      key: single ? `episode-${first.id}` : `drop-${seriesId}-${at}`,
      kind: single ? 'episode' : 'drop',
      dayKey: localDay(new Date(at)), at, seriesId, movieId: null,
      title: first.series?.title || 'Unknown show',
      season: seasons[0], seasons, episodeNumbers: group.map(numberOf), count: group.length, done,
      subtitle: single ? `S${seasonOf(first)} E${numberOf(first)}${first.title ? ` · ${first.title}` : ''}` : groupTitle(group),
      release: null, note: null, status, series: first.series || null, movie: null, firstEpisode: first,
    })
  }
  return entries
}

// A movie gives one entry per release type whose own UTC day is inside firstDay..lastDay (D4).
export function movieEntries(movies, window, now = Date.now()) {
  const today = localDay(new Date(now))
  const entries = []
  for (const movie of movies || []) {
    const days = {}
    for (const [release, value] of [['digital', movie?.digitalRelease], ['physical', movie?.physicalRelease]]) {
      const time = Date.parse(value)
      if (!Number.isFinite(time)) continue
      const day = utcDay(new Date(time))
      if (day >= window.firstDay && day <= window.lastDay) days[release] = day
    }
    if (days.digital && days.physical && days.digital === days.physical) delete days.physical
    for (const release of ['digital', 'physical']) {
      const dayKey = days[release]
      if (!dayKey) continue
      const [y, m, d] = dayKey.split('-').map(Number)
      const note = release === 'physical' && typeof movie.physicalReleaseNote === 'string' && movie.physicalReleaseNote ? movie.physicalReleaseNote : null
      const status = movie.hasFile ? 'downloaded' : (dayKey <= today && movie.monitored && movie.isAvailable ? 'missing' : null)
      entries.push({
        key: `movie-${movie.id}-${release}`, kind: 'movie', dayKey, at: Date.UTC(y, m - 1, d), seriesId: null, movieId: movie.id,
        title: movie.title || 'Unknown movie', season: null, seasons: [], episodeNumbers: [], count: 1, done: movie.hasFile ? 1 : 0,
        subtitle: `Movie · ${release === 'digital' ? 'Digital' : 'Physical'} release${note ? ` · ${note}` : ''}`,
        release, note, status, series: null, movie, firstEpisode: null,
      })
    }
  }
  return entries
}

// Inside a day: movies (title, digital before physical), then episodes and drops by instant, series title, first episode.
export function compareEntries(a, b) {
  if (a.dayKey !== b.dayKey) return a.dayKey < b.dayKey ? -1 : 1
  if ((a.kind === 'movie') !== (b.kind === 'movie')) return a.kind === 'movie' ? -1 : 1
  if (a.kind === 'movie') return a.title.localeCompare(b.title) || (a.release === b.release ? 0 : a.release === 'digital' ? -1 : 1)
  return a.at - b.at || a.title.localeCompare(b.title)
    || (a.season - b.season) || ((a.episodeNumbers[0] || 0) - (b.episodeNumbers[0] || 0))
}

export function sortEntries(entries) { return [...entries].sort(compareEntries) }

export function groupByDay(entries, now = Date.now()) {
  const today = localDay(new Date(now))
  const relativeOf = dayKey => {
    const base = dayDate(today)
    for (const [name, offset] of [['yesterday', -1], ['today', 0], ['tomorrow', 1]]) {
      const day = new Date(base); day.setDate(day.getDate() + offset)
      if (localDay(day) === dayKey) return name
    }
    return null
  }
  const days = new Map()
  for (const entry of sortEntries(entries)) {
    if (!days.has(entry.dayKey)) days.set(entry.dayKey, { dayKey: entry.dayKey, date: dayDate(entry.dayKey), relative: relativeOf(entry.dayKey), entries: [] })
    days.get(entry.dayKey).entries.push(entry)
  }
  return [...days.values()]
}

export const timeText = at => new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

// Accessible name of a tile or row (D16).
export function entryLabel(entry) {
  const weekday = (entry.kind === 'movie' ? dayDate(entry.dayKey) : new Date(entry.at)).toLocaleDateString(undefined, { weekday: 'long' })
  let text
  if (entry.kind === 'movie') text = `${entry.title}, movie, ${entry.release} release, ${weekday}`
  else {
    const when = `${weekday} ${timeText(entry.at)}`
    if (entry.kind === 'episode') text = `${entry.title}, season ${entry.season}, episode ${entry.episodeNumbers[0]}, ${when}`
    else if (entry.seasons.length > 1) text = `${entry.title}, seasons ${entry.seasons.join(', ')}, ${entry.count} episodes, ${when}`
    else {
      const min = Math.min(...entry.episodeNumbers), max = Math.max(...entry.episodeNumbers)
      const contiguous = new Set(entry.episodeNumbers).size === entry.count && max - min + 1 === entry.count
      text = contiguous ? `${entry.title}, season ${entry.season}, episodes ${min} to ${max}, ${when}` : `${entry.title}, season ${entry.season}, ${entry.count} episodes, ${when}`
    }
  }
  if (entry.status === 'downloaded') text += ', Downloaded'
  else if (entry.status === 'missing') text += ', Missing'
  else if (entry.status === 'partial') text += `, ${entry.done} of ${entry.count} downloaded`
  return text
}
