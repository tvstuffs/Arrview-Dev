import { test, expect } from 'vitest'
import { mainSeasonCounts, isMovieMissing, getMovieStatus, MOVIE_STATUS, nextRelease, releaseLabel, movieFileLine, artUrl, episodeState, wantedMissing, completenessTone,
  seasonMonitoring, showMonitoring, unmonitoredMissing, seasonSearchPlan } from '../../src/media'

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
test('artUrl falls back to an absolute url when remoteUrl is missing (queue and calendar on older Sonarr and Radarr)', () => {
  expect(artUrl({ images: [{ coverType: 'poster', url: TMDB }] }, 'poster', 'grid')).toBe('https://image.tmdb.org/t/p/w342/abc.jpg')
  expect(artUrl({ images: [{ coverType: 'poster', url: '/MediaCover/1/poster.jpg', remoteUrl: TMDB }] }, 'poster', 'grid')).toBe('https://image.tmdb.org/t/p/w342/abc.jpg')
  expect(artUrl({ images: [{ coverType: 'poster', url: 'https://a.invalid/local.jpg', remoteUrl: 'https://b.invalid/remote.jpg' }] }, 'poster', 'grid')).toBe('https://b.invalid/remote.jpg')
  expect(artUrl({ images: [{ coverType: 'poster', url: '/MediaCover/1/poster.jpg' }] }, 'poster', 'grid')).toBeNull()
  expect(artUrl({ images: [{ coverType: 'poster', url: 'javascript:alert(1)' }] }, 'poster', 'grid')).toBeNull()
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
test('wantedMissing: aired, without a file and not unmonitored; an episode without the flag counts as monitored', () => {
  const eps = [
    { id: 1, hasFile: false, airDateUtc: '2020-01-01', monitored: true },
    { id: 2, hasFile: false, airDateUtc: '2020-01-01', monitored: false },
    { id: 3, hasFile: false, airDateUtc: '2020-01-01' },
    { id: 4, hasFile: true, airDateUtc: '2020-01-01', monitored: true },
    { id: 5, hasFile: false, airDateUtc: '2099-01-01', monitored: true },
    { id: 6, hasFile: false, monitored: true },
  ]
  expect(wantedMissing(eps, NOW).map(ep => ep.id)).toEqual([1, 3])
  expect(wantedMissing(eps.filter(ep => ep.monitored === false), NOW)).toEqual([])
  expect(wantedMissing([], NOW)).toEqual([])
})
test('seasonMonitoring: on when the season and every episode are monitored, off when neither is, mixed between; a missing flag counts as monitored', () => {
  const eps = (...flags) => flags.map((monitored, id) => (monitored === undefined ? { id } : { id, monitored }))
  expect(seasonMonitoring({ monitored: true }, eps(true, true))).toBe('on')
  expect(seasonMonitoring({}, eps(undefined, true))).toBe('on')
  expect(seasonMonitoring(undefined, eps(true))).toBe('on')
  expect(seasonMonitoring({ monitored: false }, eps(false, false))).toBe('off')
  // A monitored season with episodes unmonitored one by one, and the two ways the flag and the episodes can disagree.
  expect(seasonMonitoring({ monitored: true }, eps(true, false))).toBe('mixed')
  expect(seasonMonitoring({ monitored: true }, eps(false, false))).toBe('mixed')
  expect(seasonMonitoring({ monitored: false }, eps(true, true))).toBe('mixed')
  // No episodes yet: the season's own flag decides.
  expect(seasonMonitoring({ monitored: true }, [])).toBe('on')
  expect(seasonMonitoring({ monitored: false }, [])).toBe('off')
})
test('showMonitoring: on when the show is monitored and every main season is on, off when none is, mixed between; the specials do not count', () => {
  const season = (seasonNumber, monitored) => (monitored === undefined ? { seasonNumber } : { seasonNumber, monitored })
  const eps = (seasonNumber, ...flags) => flags.map((monitored, index) => ({ id: seasonNumber * 100 + index, seasonNumber, monitored }))
  const show = (monitored, ...seasons) => ({ monitored, seasons })
  const all = [...eps(1, true, true), ...eps(2, true)]
  // The specials (season 0) may be anything.
  expect(showMonitoring(show(true, season(0, false), season(1, true), season(2, true)), [...all, ...eps(0, false)])).toBe('on')
  // A show, a season or an episode without the flag counts as monitored (Sonarr always sends it).
  expect(showMonitoring(show(undefined, season(1), season(2)), [...eps(1, undefined), ...eps(2, undefined, true)])).toBe('on')
  expect(showMonitoring(show(true, season(1, false), season(2, false)), [...eps(1, false, false), ...eps(2, false)])).toBe('off')
  // Everything is on except the show itself: Sonarr grabs nothing for an unmonitored show, so it is not "on".
  expect(showMonitoring(show(false, season(1, true), season(2, true)), all)).toBe('mixed')
  // One season off, and an episode unmonitored in a monitored season.
  expect(showMonitoring(show(true, season(1, true), season(2, false)), [...eps(1, true, true), ...eps(2, false)])).toBe('mixed')
  expect(showMonitoring(show(true, season(1, true), season(2, true)), [...eps(1, true, false), ...eps(2, true)])).toBe('mixed')
  // A season with no episodes yet: its own flag decides.
  expect(showMonitoring(show(true, season(1, true), season(2, true)), eps(1, true))).toBe('on')
  expect(showMonitoring(show(true, season(1, true), season(2, false)), eps(1, true))).toBe('mixed')
  // No main season at all: nothing to monitor.
  expect(showMonitoring(show(true, season(0, true)), [])).toBe('off')
  expect(showMonitoring({}, [])).toBe('off')
})
test('unmonitoredMissing: the aired episodes without a file that Search N Missing leaves out', () => {
  const eps = [
    { id: 1, hasFile: false, airDateUtc: '2020-01-01', monitored: false },
    { id: 2, hasFile: false, airDateUtc: '2020-01-01', monitored: true },
    { id: 3, hasFile: false, airDateUtc: '2020-01-01' },
    { id: 4, hasFile: true, airDateUtc: '2020-01-01', monitored: false },
    { id: 5, hasFile: false, airDateUtc: '2099-01-01', monitored: false },
  ]
  expect(unmonitoredMissing(eps, NOW).map(ep => ep.id)).toEqual([1])
  expect(unmonitoredMissing([], NOW)).toEqual([])
})
test('seasonSearchPlan: the whole season when every aired episode is wanted and there is more than one; otherwise the wanted ids', () => {
  const ep = (id, extra = {}) => ({ id, hasFile: false, airDateUtc: '2020-01-01', monitored: true, ...extra })
  // Every aired episode is missing and monitored; one more has not aired.
  expect(seasonSearchPlan([ep(1), ep(2), ep(3), ep(4, { airDateUtc: '2099-01-01' })], NOW)).toEqual({ ids: [1, 2, 3], whole: true })
  // One of them is on disk: the rest are searched one by one, so the file is not fetched again.
  expect(seasonSearchPlan([ep(1), ep(2), ep(3, { hasFile: true })], NOW)).toEqual({ ids: [1, 2], whole: false })
  // One of them is unmonitored: a season pack would be refused by Sonarr, so the wanted ones are searched one by one.
  expect(seasonSearchPlan([ep(1), ep(2), ep(3, { monitored: false })], NOW)).toEqual({ ids: [1, 2], whole: false })
  // A single wanted episode is an episode search, even when it is the only one that has aired.
  expect(seasonSearchPlan([ep(1), ep(2, { airDateUtc: '2099-01-01' })], NOW)).toEqual({ ids: [1], whole: false })
  expect(seasonSearchPlan([ep(1, { hasFile: true })], NOW)).toEqual({ ids: [], whole: false })
  expect(seasonSearchPlan([], NOW)).toEqual({ ids: [], whole: false })
})
const season = (seasonNumber, total, onDisk, wanted) => ({ seasonNumber, statistics: { totalEpisodeCount: total, episodeFileCount: onDisk, episodeCount: wanted } })
test('mainSeasonCounts: total, on disk, what Sonarr wants and what is missing; specials excluded; show-level fallback', () => {
  expect(mainSeasonCounts({ seasons: [season(0, 5, 5, 5), season(1, 3, 2, 3), season(2, 10, 4, 5)] })).toEqual({ total: 13, onDisk: 6, wanted: 8, missing: 2, pct: 75 })
  expect(mainSeasonCounts({ statistics: { totalEpisodeCount: 8, episodeFileCount: 6, episodeCount: 7 } })).toEqual({ total: 8, onDisk: 6, wanted: 7, missing: 1, pct: 86 })
  expect(mainSeasonCounts({})).toEqual({ total: 0, onDisk: 0, wanted: 0, missing: 0, pct: 0 })
})
test('mainSeasonCounts: nothing monitored means nothing wanted and nothing missing, however many episodes the series has', () => {
  expect(mainSeasonCounts({ seasons: [season(1, 187, 0, 0)] })).toEqual({ total: 187, onDisk: 0, wanted: 0, missing: 0, pct: 0 })
  // An unmonitored series that has files: Sonarr counts them as wanted, so the bar is complete and nothing is missing.
  expect(mainSeasonCounts({ monitored: false, seasons: [season(1, 40, 12, 12)] })).toEqual({ total: 40, onDisk: 12, wanted: 12, missing: 0, pct: 100 })
})
test('mainSeasonCounts: files beyond what is wanted never push the bar past 100 or the missing count below 0', () => {
  expect(mainSeasonCounts({ seasons: [season(1, 10, 5, 3)] })).toEqual({ total: 10, onDisk: 5, wanted: 3, missing: 0, pct: 100 })
})
test('completenessTone: red under a third, yellow under four fifths, green below complete, grey when complete', () => {
  expect([[0, 0], [0, 10], [3, 10], [4, 12], [5, 12], [7, 10], [8, 10], [9, 10], [99, 100], [10, 10], [11, 10]].map(([onDisk, total]) => completenessTone(onDisk, total)))
    .toEqual(['none', 'low', 'low', 'mid', 'mid', 'mid', 'high', 'high', 'high', 'done', 'done'])
})
