import { test, expect } from 'vitest'
import { mainSeasonCounts, isMovieMissing, getMovieStatus, MOVIE_STATUS, nextRelease, releaseLabel, movieFileLine, artUrl, episodeState } from '../../src/media'

const NOW = Date.parse('2026-10-17T12:00:00Z')
const TMDB = 'https://image.tmdb.org/t/p/original/abc.jpg'
const img = (coverType, remoteUrl) => ({ images: [{ coverType, remoteUrl }] })

test('artUrl rewrites TMDB originals to the width the view needs', () => {
  expect(artUrl(img('poster', TMDB), 'poster', 'grid')).toBe('https://image.tmdb.org/t/p/w342/abc.jpg')
  expect(artUrl(img('poster', TMDB), 'poster', 'detail')).toBe('https://image.tmdb.org/t/p/w780/abc.jpg')
  expect(artUrl(img('fanart', TMDB), 'fanart', 'backdrop')).toBe('https://image.tmdb.org/t/p/w1280/abc.jpg')
})
test('artUrl leaves other hosts and other TMDB sizes unchanged, and never rewrites stills', () => {
  expect(artUrl(img('poster', 'https://img.example.invalid/p.jpg'), 'poster', 'grid')).toBe('https://img.example.invalid/p.jpg')
  expect(artUrl(img('poster', 'https://image.tmdb.org/t/p/w500/abc.jpg'), 'poster', 'grid')).toBe('https://image.tmdb.org/t/p/w500/abc.jpg')
  expect(artUrl(img('screenshot', TMDB), 'screenshot', 'still')).toBe(TMDB)
})
test('artUrl rejects unsafe schemes, missing urls and other cover types', () => {
  for (const remoteUrl of ['javascript:alert(1)', 'data:image/png;base64,AAAA', undefined, '', 42]) expect(artUrl(img('poster', remoteUrl), 'poster', 'grid')).toBeNull()
  expect(artUrl(img('fanart', TMDB), 'poster', 'grid')).toBeNull()
  expect(artUrl({}, 'poster', 'grid')).toBeNull()
  expect(artUrl(null, 'poster', 'grid')).toBeNull()
  expect(artUrl({ images: [{ coverType: 'poster', remoteUrl: 'javascript:x' }, { coverType: 'poster', remoteUrl: 'https://a.invalid/p.jpg' }] }, 'poster', 'grid')).toBe('https://a.invalid/p.jpg')
})
test('nextRelease picks the earliest future date, digital on a tie, and falls back to null', () => {
  const day = n => new Date(NOW + n * 86400000).toISOString()
  expect(nextRelease({ digitalRelease: day(10), physicalRelease: day(3) }, NOW)).toMatchObject({ kind: 'Physical' })
  expect(nextRelease({ digitalRelease: day(5), physicalRelease: day(5) }, NOW)).toMatchObject({ kind: 'Digital' })
  expect(nextRelease({ digitalRelease: day(-2), physicalRelease: day(8) }, NOW)).toMatchObject({ kind: 'Physical' })
  expect(nextRelease({ digitalRelease: day(-2), physicalRelease: 'not a date' }, NOW)).toBeNull()
  expect(nextRelease({}, NOW)).toBeNull()
})
test('releaseLabel shows month and day, plus the year when it is not the current year', () => {
  const same = nextRelease({ digitalRelease: '2026-12-05T00:00:00Z' }, NOW)
  expect(releaseLabel(same, NOW)).toBe(`Digital ${same.date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`)
  const later = nextRelease({ physicalRelease: '2027-02-05T12:00:00Z' }, NOW)
  expect(releaseLabel(later, NOW)).toBe(`Physical ${later.date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`)
})
test('movie status helpers keep the Classic rules', () => {
  expect(getMovieStatus({ hasFile: true })).toBe('available')
  expect(getMovieStatus({ isAvailable: false, status: 'inCinemas' })).toBe('inCinemas')
  expect(getMovieStatus({ isAvailable: false })).toBe('announced')
  expect(getMovieStatus({ isAvailable: true })).toBe('missing')
  expect(MOVIE_STATUS.inCinemas.label).toBe('In Cinemas')
  expect(isMovieMissing({ monitored: true, isAvailable: true })).toBe(true)
  expect(isMovieMissing({ monitored: false, isAvailable: true })).toBe(false)
  expect(isMovieMissing({ monitored: true, isAvailable: true, hasFile: true })).toBe(false)
})
test('movieFileLine uses the Classic expression and fallbacks', () => {
  expect(movieFileLine({ hasFile: false })).toBeNull()
  expect(movieFileLine({ hasFile: true })).toBeNull()
  expect(movieFileLine({ hasFile: true, movieFile: {} })).toBe('Downloaded · Size unknown · Resolution unknown · Languages unknown')
  expect(movieFileLine({ hasFile: true, movieFile: { size: 1073741824, quality: { quality: { name: 'Bluray-1080p', resolution: 1080 } }, languages: [{ name: 'English' }, { name: 'French' }] } }))
    .toBe('Bluray-1080p · 1.0 GB · 1080 · English, French')
})
test('episodeState: downloaded, missing (aired) and upcoming (future or undated)', () => {
  expect(episodeState({ hasFile: true, airDateUtc: '2099-01-01' }, NOW)).toBe('downloaded')
  expect(episodeState({ hasFile: false, airDateUtc: '2020-01-01' }, NOW)).toBe('missing')
  expect(episodeState({ hasFile: false, airDateUtc: '2099-01-01' }, NOW)).toBe('upcoming')
  expect(episodeState({ hasFile: false }, NOW)).toBe('upcoming')
})
test('mainSeasonCounts excludes specials and falls back to show-level statistics', () => {
  expect(mainSeasonCounts({ seasons: [{ seasonNumber: 0, statistics: { totalEpisodeCount: 5, episodeFileCount: 5 } }, { seasonNumber: 1, statistics: { totalEpisodeCount: 3, episodeFileCount: 2 } }] })).toEqual({ total: 3, onDisk: 2 })
  expect(mainSeasonCounts({ statistics: { totalEpisodeCount: 8, episodeFileCount: 6 } })).toEqual({ total: 8, onDisk: 6 })
  expect(mainSeasonCounts({})).toEqual({ total: 0, onDisk: 0 })
})
