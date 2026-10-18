import { vi } from 'vitest'

// Shared fixtures and stubs for the Modern layout tests. Fixture data only; image URLs use .invalid hosts or a TMDB-shaped path.
export const reply = (data, ok = true) => ({ ok, status: ok ? 200 : 503, json: async () => data })
export const DAY = 86400000
export const past = days => new Date(Date.now() - days * DAY).toISOString()
export const future = days => new Date(Date.now() + days * DAY).toISOString()

export const config = {
  sabnzbd: { url: 'http://sab.invalid', apikey: 'k' }, nzbhydra: { url: 'http://hydra.invalid', apikey: 'k' },
  sonarr: { url: 'http://sonarr.invalid', apikey: 'k' }, radarr: { url: 'http://radarr.invalid', apikey: 'k' },
}

export const tmdb = file => `https://image.tmdb.org/t/p/original/${file}`
export const series = [
  { id: 1, title: 'Alpha Show', titleSlug: 'alpha-show', year: 2020, network: 'Net One', status: 'continuing', monitored: true, genres: ['Drama', 'Crime', 'Thriller', 'Extra'],
    overview: 'A fixture overview for the Alpha Show.', images: [{ coverType: 'poster', remoteUrl: tmdb('alpha-poster.jpg') }, { coverType: 'fanart', remoteUrl: tmdb('alpha-fanart.jpg') }],
    seasons: [{ seasonNumber: 0, statistics: { totalEpisodeCount: 1, episodeFileCount: 0 } }, { seasonNumber: 1, statistics: { totalEpisodeCount: 2, episodeFileCount: 2 } }, { seasonNumber: 2, statistics: { totalEpisodeCount: 3, episodeFileCount: 1 } }] },
  { id: 2, title: 'Beta Show', year: 2018, network: 'Net Two', status: 'ended', monitored: false, images: [],
    seasons: [{ seasonNumber: 1, statistics: { totalEpisodeCount: 4, episodeFileCount: 1 } }] },
  { id: 3, title: 'Gamma Show', year: 2022, network: '', status: 'continuing', monitored: true, images: [{ coverType: 'poster', remoteUrl: 'javascript:alert(1)' }],
    seasons: [{ seasonNumber: 1, statistics: { totalEpisodeCount: 2, episodeFileCount: 2 } }] },
]
export const episodes = [
  { id: 100, seasonNumber: 0, episodeNumber: 1, title: 'A special', hasFile: false, airDateUtc: past(100) },
  { id: 101, seasonNumber: 1, episodeNumber: 1, title: 'Pilot', hasFile: true, episodeFileId: 1, airDateUtc: past(90), runtime: 42, overview: 'Pilot overview', images: [{ coverType: 'screenshot', remoteUrl: 'https://img.invalid/pilot.jpg' }] },
  { id: 102, seasonNumber: 1, episodeNumber: 2, title: 'Second', hasFile: true, episodeFileId: 2, airDateUtc: past(80) },
  { id: 201, seasonNumber: 2, episodeNumber: 1, title: 'Return', hasFile: true, episodeFileId: 3, airDateUtc: past(30) },
  { id: 202, seasonNumber: 2, episodeNumber: 2, title: 'Gone Missing', hasFile: false, airDateUtc: past(20), runtime: 0, images: [{ coverType: 'screenshot', remoteUrl: 'https://img.invalid/missing.jpg' }] },
  { id: 203, seasonNumber: 2, episodeNumber: 3, title: 'Coming Up', hasFile: false, airDateUtc: future(20) },
]
export const movies = [
  { id: 11, title: 'Movie One', year: 2024, studio: 'Studio A', hasFile: true, monitored: true, isAvailable: true, overview: 'Movie one overview', added: past(10),
    movieFile: { id: 5, size: 2147483648, quality: { quality: { name: 'WEBDL-1080p' } }, mediaInfo: { resolution: '1920x1080' }, languages: [{ name: 'English' }] },
    images: [{ coverType: 'poster', remoteUrl: tmdb('one-poster.jpg') }, { coverType: 'fanart', remoteUrl: tmdb('one-fanart.jpg') }] },
  { id: 12, title: 'Movie Two', year: 2025, studio: 'Studio B', hasFile: false, monitored: true, isAvailable: true, added: past(5), images: [] },
  { id: 13, title: 'Movie Three', year: 2026, studio: '', hasFile: false, monitored: true, isAvailable: false, status: 'announced', added: past(1), digitalRelease: future(5), physicalRelease: future(40), images: [] },
  { id: 14, title: 'Movie Four', year: 2019, studio: 'Studio D', hasFile: false, monitored: false, isAvailable: true, added: past(50), images: [] },
]

// Fetch stub keyed by URL prefix. `overrides` map a prefix to a function (url, init) => response.
export function stubFetch(overrides = {}, data = {}) {
  const calls = []
  const fn = vi.fn(async (url, init) => {
    url = String(url)
    calls.push({ url, init })
    for (const prefix of Object.keys(overrides)) if (url.startsWith(prefix)) return overrides[prefix](url, init)
    if (url.startsWith('/api/sonarr/series/') && url.includes('/episodes')) return reply(data.episodes || episodes)
    if (url.startsWith('/api/sonarr/series')) return reply(data.series || series)
    if (url.startsWith('/api/radarr/movies')) return reply(data.movies || movies)
    if (url.startsWith('/api/arrview/identify')) return reply({ capabilities: data.capabilities || ['movieDelete'], version: '1.9A1' })
    if (url.startsWith('/api/sabnzbd/queue')) return reply({ queue: { status: 'Idle', slots: [] } })
    if (url.startsWith('/api/sabnzbd/history')) return reply({ history: { slots: [] } })
    if (url.startsWith('/api/sonarr/calendar')) return reply(data.calendar || [])
    if (url.startsWith('/api/radarr/calendar')) return reply(data.radarrCalendar || [])
    if (url.includes('/ping')) return reply({})
    return reply({})
  })
  fn.calls = calls
  vi.stubGlobal('fetch', fn)
  return fn
}

// Per-query matchMedia: phone (max-width: 639px) and hover capability.
export function stubMedia({ phone = false, hover = true } = {}) {
  const original = window.matchMedia
  window.matchMedia = query => {
    const target = new EventTarget()
    target.media = query
    target.matches = /max-width:\s*639px/.test(query) ? phone : /hover:\s*hover/.test(query) ? hover : false
    return target
  }
  return () => { window.matchMedia = original }
}

export function resetEnvironment() {
  localStorage.clear()
  window.history.replaceState(null, '', '/')
  Object.defineProperty(document, 'hidden', { configurable: true, value: false })
  vi.stubGlobal('EventSource', class { addEventListener() {} close() {} })
}
