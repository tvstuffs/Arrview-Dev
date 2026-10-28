import { describe, test, expect, afterEach } from 'vitest'
import {
  normalise, categoryInfo, tidyName, parseRelease, qualityLine, statusKind, buildQueueItems, buildHistoryItems, matchHistory, relativeTime,
  formatSize, formatSpeed, formatLeft, percentOf, episodeSummary, hintFor, leadItem, pillItem, rowStatus, liveStatus, idleLead,
} from '../../src/downloads'

const SHOW_RELEASE = 'Fixture.Show.Name.S02E05.2160p.WEB-DL.DV.HDR.Atmos.x265-GRP'
const FILM_RELEASE = 'Fixture.Film.Title.2023.1080p.BluRay.x264-GRP'
const MUSIC_RELEASE = 'Fixture.Artist-Fixture.Album-2024-FLAC-24bit-GRP'
const slot = (id, extra = {}) => ({ nzo_id: id, filename: `Release.${id}`, status: 'Downloading', percentage: '40', mb: '1000', mbleft: '600', cat: 'tv', ...extra })
const record = (downloadId, extra = {}) => ({ id: 1, downloadId, seriesId: 7, episodeId: 70, series: { id: 7, title: 'Fixture Show', images: [] }, episode: { id: 70, seasonNumber: 2, episodeNumber: 5, title: 'Fixture episode' }, quality: { name: 'WEBDL-2160p' }, ...extra })
const ok = records => ({ state: 'ok', records })

describe('matching queue slots (criterion 1)', () => {
  test('an exact downloadId matches; case, null and empty ids do not', () => {
    const items = buildQueueItems([slot('SABnzbd_nzo_AbC'), slot('SABnzbd_nzo_abc2'), slot('nzo_null')], {
      sonarr: ok([record('SABnzbd_nzo_AbC'), record('SABnzbd_NZO_ABC2'), record(null), record('')]),
    })
    expect(items.map(item => item.matched)).toEqual([true, false, false])
    expect(items[0].title).toBe('Fixture Show')
    expect(items[1].kind).toBe('unmatched')
  })
  test('records with one downloadId become one pack item', () => {
    const records = [1, 2, 3].map(n => record('pack', { id: n, episodeId: 70 + n, episode: { id: 70 + n, seasonNumber: 3, episodeNumber: n, title: `E${n}` } }))
    const [item] = buildQueueItems([slot('pack')], { sonarr: ok(records) })
    expect(item.subtitle).toBe('S3 · Episodes 1–3')
    expect(item.heroSubtitle).toBe('Season 3, Episodes 1–3')
    expect(item.episodeIds).toEqual([71, 72, 73])
  })
  test('Sonarr wins over Radarr on a double match, and Radarr matches movies', () => {
    const movie = { movieId: 9, downloadId: 'both', movie: { id: 9, title: 'Fixture Film', year: 2023, images: [] }, quality: { name: 'Bluray-1080p' } }
    const [both] = buildQueueItems([slot('both')], { sonarr: ok([record('both')]), radarr: ok([movie]) })
    expect(both.kind).toBe('tv')
    const [film] = buildQueueItems([slot('both', { cat: 'movies' })], { sonarr: ok([]), radarr: ok([movie]) })
    expect(film).toMatchObject({ kind: 'movie', title: 'Fixture Film', mediaId: 9, subtitle: '2023 · Movie', quality: '1080p' })
  })
  test('a service that is off, errored without kept records, idle or pending yields unmatched slots', () => {
    for (const state of ['off', 'error', 'idle', 'pending']) {
      expect(buildQueueItems([slot('a')], { sonarr: { state, records: [record('a')] } })[0].matched, state).toBe(false)
    }
    expect(buildQueueItems([slot('a')], { sonarr: { state: 'error', kept: true, records: [record('a')] } })[0].matched).toBe(true)
  })
  test('a matched record with no series or episode is still a match', () => {
    const [item] = buildQueueItems([slot('a', { filename: SHOW_RELEASE })], { sonarr: ok([{ downloadId: 'a', series: null, episode: null }]) })
    expect(item.matched).toBe(true)
    expect(item.title).toBe('Fixture Show Name')
    expect(item.subtitle).toBe('')
  })
})

describe('episodeSummary (criterion 2)', () => {
  const ep = (season, number, title = `T${number}`) => ({ seasonNumber: season, episodeNumber: number, title })
  test('one episode, with and without a title', () => {
    expect(episodeSummary([ep(2, 5, 'Fixture episode')])).toEqual({ hero: 'Season 2, Episode 5 · Fixture episode', row: 'S2 E5 · Fixture episode' })
    expect(episodeSummary([ep(2, 5, '')])).toEqual({ hero: 'Season 2, Episode 5', row: 'S2 E5' })
  })
  test('contiguous, non-contiguous and multi-season packs', () => {
    expect(episodeSummary(Array.from({ length: 8 }, (_, i) => ep(3, 8 - i)))).toEqual({ hero: 'Season 3, Episodes 1–8', row: 'S3 · Episodes 1–8' })
    expect(episodeSummary([ep(3, 1), ep(3, 2), ep(3, 4)])).toEqual({ hero: 'Season 3 · 3 episodes', row: 'S3 · 3 episodes' })
    expect(episodeSummary([...Array.from({ length: 4 }, (_, i) => ep(2, i + 1)), ...Array.from({ length: 5 }, (_, i) => ep(3, i + 1))]))
      .toEqual({ hero: 'Seasons 2, 3 · 9 episodes', row: 'S2, S3 · 9 episodes' })
  })
  test('a null episode is ignored', () => {
    expect(episodeSummary([null])).toEqual({ hero: '', row: '' })
    expect(episodeSummary([null, ep(1, 2, 'Two')]).row).toBe('S1 E2 · Two')
  })
})

describe('history matching (criterion 3)', () => {
  const series = [{ id: 1, title: 'Fixture Show', year: 2020 }, { id: 2, title: 'Fixture Show', year: 2015 }, { id: 3, title: 'Fixture & Co', year: 2021 }, { id: 4, title: 'Other Show', year: 2019 }]
  const movies = [{ id: 10, title: 'Fixture Film', year: 2023 }, { id: 11, title: 'Fixture Film', year: 1999 }]
  const libs = { series, movies }
  test('normalise', () => {
    expect(normalise('Fixture & Co.: The Show!')).toBe('fixtureandcotheshow')
    expect(normalise(null)).toBe('')
  })
  test('TV by normalised title, season and episode, with the year to disambiguate', () => {
    expect(matchHistory('Other.Show.S01E02.720p.HDTV-GRP', libs)).toMatchObject({ kind: 'tv', series: { id: 4 }, season: 1, number: 2 })
    expect(matchHistory('Fixture.and.Co.S10E100.WEB-GRP', libs)).toMatchObject({ kind: 'tv', series: { id: 3 }, season: 10, number: 100 })
    expect(matchHistory('Fixture.Show.2020.S01E01.WEB-GRP', libs)).toMatchObject({ series: { id: 1 } })
    expect(matchHistory('Fixture.Show.2015.S01E01.WEB-GRP', libs)).toMatchObject({ series: { id: 2 } })
    expect(matchHistory('Fixture.Show.(2020).S01E01.WEB-GRP', libs)).toMatchObject({ series: { id: 1 } })
  })
  test('a trailing year in a series title is matched whole', () => {
    expect(matchHistory('Dated.Fixture.2020.S01E01-GRP', { series: [{ id: 5, title: 'Dated Fixture 2020', year: 2020 }] })).toMatchObject({ series: { id: 5 } })
  })
  test('unmatched: unknown title, two series that both fit, wrong year, list not loaded', () => {
    expect(matchHistory('Unknown.Show.S01E01-GRP', libs)).toBeNull()
    expect(matchHistory('Fixture.Show.S01E01.WEB-GRP', libs)).toBeNull()
    expect(matchHistory('Fixture.Show.1999.S01E01.WEB-GRP', libs)).toBeNull()
    expect(matchHistory('Other.Show.S01E01-GRP', { series: null, movies })).toBeNull()
  })
  test('season packs: S03 and S01-S03 with no episode number match the series', () => {
    expect(matchHistory('Other.Show.S03.1080p.WEB-DL.DDP5.1-GRP', libs)).toEqual({ kind: 'tv', series: series[3], season: 3, number: null, lastSeason: null })
    expect(matchHistory('other.show.s02.720p.hdtv-grp', libs)).toMatchObject({ series: { id: 4 }, season: 2, number: null })
    expect(matchHistory('Other.Show.S01-S03.1080p.BluRay-GRP', libs)).toMatchObject({ series: { id: 4 }, season: 1, number: null, lastSeason: 3 })
    expect(matchHistory('Fixture.Show.2015.S04.2160p.WEB-GRP', libs)).toMatchObject({ series: { id: 2 }, season: 4, number: null })
    expect(matchHistory('Fixture.Show.S04.2160p.WEB-GRP', libs)).toBeNull()
    expect(matchHistory('Other.Show.S2024.WEB-GRP', libs)).toBeNull()
  })
  test('a Sonarr title ending in (year) matches a release without the year; an exact title wins', () => {
    const dated = [{ id: 7, title: 'Tracker (2024)', year: 2024 }]
    expect(matchHistory('tracker.s04e01.2160p.web.h265-grp', { series: dated })).toMatchObject({ series: { id: 7 }, season: 4, number: 1 })
    expect(matchHistory('Tracker.2024.S04E04.720p.HDTV-GRP', { series: dated })).toMatchObject({ series: { id: 7 } })
    expect(matchHistory('Tracker.S01.1080p-GRP', { series: dated })).toMatchObject({ series: { id: 7 }, number: null })
    expect(matchHistory('Tracker.S01E01-GRP', { series: [...dated, { id: 8, title: 'Tracker', year: 1990 }] })).toMatchObject({ series: { id: 8 } })
    expect(matchHistory('Tracker.S01E01-GRP', { series: [...dated, { id: 9, title: 'Tracker (1990)', year: 1990 }] })).toBeNull()
    expect(matchHistory('..S01E01-GRP', { series: [{ id: 10, title: '!!!', year: 2020 }] })).toBeNull()
  })
  test('movies by normalised title and year', () => {
    expect(matchHistory(FILM_RELEASE.replace('Film.Title', 'Film'), libs)).toMatchObject({ kind: 'movie', movie: { id: 10 } })
    expect(matchHistory('Fixture.Film.1999.1080p-GRP', libs)).toMatchObject({ movie: { id: 11 } })
    expect(matchHistory('Fixture.Film.2001.1080p-GRP', libs)).toBeNull()
    expect(matchHistory('Fixture.Film.2023.1080p-GRP', { series, movies: null })).toBeNull()
    expect(matchHistory('Fixture.Film.2023.1080p-GRP', { series: null, movies })).toMatchObject({ movie: { id: 10 } })
  })
  test('history items carry the match, the hint rule and their own list state', () => {
    const slots = [{ nzo_id: 'a', name: 'Other.Show.S01E02.720p-GRP', status: 'Completed', bytes: 1073741824, completed: 100 },
      { nzo_id: 'b', name: 'Missing.Show.S01E02.720p-GRP', status: 'Completed', mb: '512', completed: 90, category: 'tv' },
      { nzo_id: 'c', name: 'Fixture.Film.2023.1080p-GRP', status: 'Failed', bytes: 5, category: 'movies' }]
    const items = buildHistoryItems(slots, libs, { sonarr: true, radarr: true })
    expect(items.map(item => [item.matched, item.title, item.subtitle, item.size, item.hint])).toEqual([
      [true, 'Other Show', 'S1 E2', '1.0 GB', null], [false, 'Missing Show', 'TV · S1 E2', '512 MB', 'Not in Sonarr'], [true, 'Fixture Film', '2023 · Movie', '0 MB', null]])
    const unloaded = buildHistoryItems(slots, { series: null, movies: null }, { sonarr: true, radarr: true })
    expect(unloaded.map(item => item.hint)).toEqual([null, null, null])
  })
  test('a season pack is a matched history item with a Season subtitle, and it can lead', () => {
    const art = [{ coverType: 'poster', remoteUrl: 'https://img.invalid/p.jpg' }]
    const lib = { series: [{ id: 1, title: 'Art Show', images: art }], movies: [] }
    const slots = [{ nzo_id: 'pack', name: 'Art.Show.S03.1080p.WEB-DL-GRP', status: 'Completed', completed: 500, category: 'tv' },
      { nzo_id: 'run', name: 'Art.Show.S01-S02.1080p.BluRay-GRP', status: 'Completed', completed: 400, category: 'tv' },
      { nzo_id: 'episode', name: 'Art.Show.S02E01-GRP', status: 'Completed', completed: 300, category: 'tv' },
      { nzo_id: 'stranger', name: 'Unknown.Show.S05.1080p-GRP', status: 'Completed', completed: 200, category: 'tv' }]
    const items = buildHistoryItems(slots, lib, { sonarr: true, radarr: true })
    expect(items.map(item => [item.matched, item.title, item.subtitle, item.hint])).toEqual([
      [true, 'Art Show', 'Season 3', null], [true, 'Art Show', 'Seasons 1–2', null], [true, 'Art Show', 'S2 E1', null], [false, 'Unknown Show', 'TV · S5', 'Not in Sonarr']])
    expect(idleLead(items).key).toBe('pack')
  })
  test('the idle lead is the newest Completed matched item with art', () => {
    const art = [{ coverType: 'poster', remoteUrl: 'https://img.invalid/p.jpg' }]
    const lib = { series: [{ id: 1, title: 'Art Show', images: art }, { id: 2, title: 'Bare Show', images: [] }], movies: [] }
    const slots = [
      { nzo_id: 'new-bare', name: 'Bare.Show.S01E01-GRP', status: 'Completed', completed: 500 },
      { nzo_id: 'new-failed', name: 'Art.Show.S01E03-GRP', status: 'Failed', completed: 400 },
      { nzo_id: 'new-unmatched', name: 'Nothing.Here.S01E01-GRP', status: 'Completed', completed: 300 },
      { nzo_id: 'old-art', name: 'Art.Show.S01E02-GRP', status: 'Completed', completed: 200 },
      { nzo_id: 'older-art', name: 'Art.Show.S01E01-GRP', status: 'Completed', completed: 100 }]
    expect(idleLead(buildHistoryItems(slots, lib, {})).key).toBe('old-art')
    expect(idleLead(buildHistoryItems(slots.slice(0, 3), lib, {}))).toBeNull()
  })
})

describe('categories (criterion 4)', () => {
  test('the eight mapped categories, case-insensitively', () => {
    expect([['tv', 'TV', 'television-simple'], ['Movies', 'Movie', 'film-slate'], ['music', 'Music', 'music-notes'], ['audio', 'Music', 'music-notes'],
      ['books', 'Book', 'book-open'], ['ebooks', 'Book', 'book-open'], ['software', 'Software', 'package'], ['apps', 'Software', 'package']]
      .map(([cat, label, icon]) => [categoryInfo(cat).label, categoryInfo(cat).icon, label, icon].join('|')))
      .toEqual([['TV', 'television-simple'], ['Movie', 'film-slate'], ['Music', 'music-notes'], ['Music', 'music-notes'], ['Book', 'book-open'], ['Book', 'book-open'],
        ['Software', 'package'], ['Software', 'package']].map(([label, icon]) => `${label}|${icon}|${label}|${icon}`))
  })
  test('the rest fall back to the file glyph', () => {
    expect(categoryInfo('*')).toEqual({ label: 'Download', icon: 'file' })
    expect(categoryInfo('')).toEqual({ label: 'Download', icon: 'file' })
    expect(categoryInfo(undefined)).toEqual({ label: 'Download', icon: 'file' })
    expect(categoryInfo('games')).toEqual({ label: 'Games', icon: 'file' })
  })
})

describe('names (criterion 5)', () => {
  test('tidyName fixtures', () => {
    expect(tidyName(SHOW_RELEASE)).toBe('Fixture Show Name')
    expect(tidyName(FILM_RELEASE)).toBe('Fixture Film Title')
    expect(tidyName(MUSIC_RELEASE)).toBe('Fixture Artist-Fixture Album')
    expect(tidyName('Fixture.Film.Title.1080p.BluRay.x264-GRP')).toBe('Fixture Film Title')
    expect(tidyName('Fixture.Group.Name.x265-GRP')).toBe('Fixture Group Name')
    expect(tidyName('Fixture.Editor.3.2.1.x64.Setup')).toBe('Fixture Editor 3 2 1 x64 Setup')
    expect(tidyName('Fixture Plain Release Name')).toBe('Fixture Plain Release Name')
    expect(tidyName('2160p.Fixture')).toBe('2160p.Fixture')
    expect(tidyName('Fixture_Under_Score.S01E01.nzb')).toBe('Fixture Under Score')
    expect(tidyName('Fixture.Show.Name.S03.1080p.WEB-DL-GRP')).toBe('Fixture Show Name')
    expect(tidyName('Fixture.Show.Name.S01-S03.1080p-GRP')).toBe('Fixture Show Name')
    expect(tidyName('')).toBe('')
  })
  test('parseRelease', () => {
    expect(parseRelease(SHOW_RELEASE)).toEqual({ season: 2, episode: 5, year: null, resolution: '4K', flags: ['Dolby Vision', 'HDR', 'Atmos'] })
    expect(parseRelease(FILM_RELEASE)).toEqual({ season: null, episode: null, year: 2023, resolution: '1080p', flags: [] })
    expect(parseRelease(MUSIC_RELEASE)).toEqual({ season: null, episode: null, year: 2024, resolution: null, flags: ['FLAC', '24-bit'] })
    expect(parseRelease('Fixture.Editor.3.2.1.x64.Setup')).toMatchObject({ season: null, year: null, resolution: null, flags: [] })
    expect(parseRelease('Fixture.Show.S03.1080p.WEB-DL.DDP5.1.Atmos-GRP')).toEqual({ season: 3, episode: null, year: null, resolution: '1080p', flags: ['Atmos'] })
    expect(parseRelease('Fixture.Show.S01-S03.720p-GRP')).toMatchObject({ season: 1, episode: null })
    expect(parseRelease('S1m0ne.2002.1080p-GRP')).toMatchObject({ season: null, year: 2002 })
  })
  test('hint rules (D16)', () => {
    const both = { sonarr: true, radarr: true }
    expect(hintFor(SHOW_RELEASE, 'tv', both)).toBe('Not in Sonarr')
    expect(hintFor(SHOW_RELEASE, 'tv', { sonarr: false, radarr: true })).toBeNull()
    expect(hintFor(FILM_RELEASE, 'movies', both)).toBe('Not in Radarr')
    expect(hintFor(FILM_RELEASE, 'movies', { sonarr: true, radarr: false })).toBeNull()
    expect(hintFor(FILM_RELEASE, 'software', both)).toBeNull()
    expect(hintFor(FILM_RELEASE, undefined, both)).toBeNull()
    expect(hintFor(MUSIC_RELEASE, 'music', both)).toBeNull()
  })
  test('queue hints follow the service state', () => {
    const slots = [slot('a', { filename: SHOW_RELEASE }), slot('b', { filename: FILM_RELEASE, cat: 'movies' })]
    expect(buildQueueItems(slots, { sonarr: ok([]), radarr: ok([]) }).map(item => item.hint)).toEqual(['Not in Sonarr', 'Not in Radarr'])
    expect(buildQueueItems(slots, { sonarr: { state: 'error', records: [] }, radarr: { state: 'off', records: [] } }).map(item => item.hint)).toEqual([null, null])
    expect(buildQueueItems(slots, {}).map(item => item.hint)).toEqual([null, null])
  })
  test('unmatched items get a category subtitle with the marker or the year', () => {
    const items = buildQueueItems([slot('a', { filename: SHOW_RELEASE }), slot('b', { filename: FILM_RELEASE, cat: 'movies' }),
      slot('c', { filename: 'Fixture.Artist-Fixture.Album-FLAC-24bit-GRP', cat: 'music' })], {})
    expect(items.map(item => item.subtitle)).toEqual(['TV · S2 E5', 'Movie · 2023', 'Music'])
    expect(items[2]).toMatchObject({ title: 'Fixture Artist-Fixture Album', quality: 'FLAC · 24-bit', category: { label: 'Music', icon: 'music-notes' } })
  })
})

describe('quality line (criterion 6)', () => {
  test('record quality plus flags from the release', () => {
    expect(qualityLine({ qualityName: 'WEBDL-2160p', release: SHOW_RELEASE })).toBe('4K · Dolby Vision · HDR · Atmos')
    expect(qualityLine({ qualityName: 'Bluray-1080p', release: FILM_RELEASE })).toBe('1080p')
  })
  test('falls back to the release name, uses non-resolution names verbatim', () => {
    expect(qualityLine({ release: SHOW_RELEASE })).toBe('4K · Dolby Vision · HDR · Atmos')
    expect(qualityLine({ qualityName: 'DVD', release: 'Fixture.Film.DVD-GRP' })).toBe('DVD')
    expect(qualityLine({ qualityName: 'Unknown', release: 'x' })).toBe('Unknown')
  })
  test('tokens are bounded: HDRip is not HDR, Remux counts once, Dolby Vision spelled out', () => {
    expect(qualityLine({ release: 'Fixture.Film.HDRip.x264-GRP' })).toBe('')
    expect(qualityLine({ qualityName: 'Remux-1080p', release: 'Fixture.Film.1080p.Remux.AVC-GRP' })).toBe('1080p · Remux')
    expect(qualityLine({ release: 'Fixture.Film.2160p.Dolby.Vision.HDR10+-GRP' })).toBe('4K · Dolby Vision · HDR')
    expect(qualityLine({ release: 'Fixture.Film.2160p.DoVi.HLG-GRP' })).toBe('4K · Dolby Vision · HLG')
  })
  test('music and empty', () => {
    expect(qualityLine({ release: MUSIC_RELEASE })).toBe('FLAC · 24-bit')
    expect(qualityLine({ release: 'Fixture.Editor.3.2.1.x64.Setup' })).toBe('')
    expect(qualityLine()).toBe('')
  })
})

describe('formatting (criterion 7)', () => {
  test('sizes, speeds and percentages', () => {
    expect([formatSize(null), formatSize('x'), formatSize(512), formatSize('9216'), formatSize(5939)]).toEqual(['—', '—', '512 MB', '9.0 GB', '5.8 GB'])
    expect([formatSpeed(48230), formatSpeed('800'), formatSpeed(0), formatSpeed(undefined)]).toEqual(['47.1 MB/s', '800 KB/s', '—', '—'])
    expect([percentOf({ percentage: '64.9' }), percentOf({ percentage: '250' }), percentOf({ percentage: '-3' }), percentOf({ percentage: 'abc' }), percentOf({})]).toEqual([64, 100, 0, 0, 0])
  })
  test('formatLeft', () => {
    expect([formatLeft('0:01:10'), formatLeft('0:00:00'), formatLeft('1:30:00'), formatLeft('garbage'), formatLeft(undefined), formatLeft('0:20:00'), formatLeft('2:00:00')])
      .toEqual(['1 min left', null, '1 hr 30 min left', null, null, '20 min left', '2 hr left'])
    expect(formatLeft('1:02:00:00')).toBe('26 hr left')
  })
  describe('relativeTime', () => {
    const original = process.env.TZ
    afterEach(() => { if (original === undefined) delete process.env.TZ; else process.env.TZ = original })
    const NOW = Date.parse('2026-03-18T15:00:00Z')
    const secs = ms => (NOW - ms) / 1000
    const use = zone => { process.env.TZ = zone; expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(zone) }
    test('minutes, hours, yesterday, days, old dates in UTC', () => {
      use('UTC')
      expect(relativeTime(secs(10000), NOW)).toBe('Just now')
      expect(relativeTime(secs(-5000), NOW)).toBe('Just now')
      expect(relativeTime(secs(25 * 60000), NOW)).toBe('25 min ago')
      expect(relativeTime(secs(3 * 3600000), NOW)).toBe('3 hr ago')
      expect(relativeTime(secs(86400000), NOW)).toBe('Yesterday')
      expect(relativeTime(secs(3 * 86400000), NOW)).toBe('3 days ago')
      expect(relativeTime(secs(30 * 86400000), NOW)).toBe('Feb 16')
      expect(relativeTime(secs(400 * 86400000), NOW)).toBe('Feb 11, 2025')
    })
    test('invalid input is null, and a fresh download across midnight is minutes, not Yesterday', () => {
      use('UTC')
      expect([relativeTime(null, NOW), relativeTime(0, NOW), relativeTime('x', NOW), relativeTime(-4, NOW)]).toEqual([null, null, null, null])
      const justAfterMidnight = Date.parse('2026-03-18T00:10:00Z')
      expect(relativeTime((justAfterMidnight - 20 * 60000) / 1000, justAfterMidnight)).toBe('20 min ago')
      expect(relativeTime(Date.parse('2026-03-17T22:00:00Z') / 1000, justAfterMidnight)).toBe('Yesterday')
    })
    test('calendar days are local', () => {
      use('Pacific/Auckland')
      const now = Date.parse('2026-03-18T15:00:00Z')
      expect(relativeTime(Date.parse('2026-03-18T06:00:00Z') / 1000, now)).toBe('Yesterday')
    })
  })
})

describe('status kinds and lead selection (criterion 8)', () => {
  test('each SABnzbd status maps per D17', () => {
    const kinds = ['Downloading', 'Fetching', 'Grabbing', 'Paused', 'Queued', 'Propagating', 'Idle', 'Verifying', 'Repairing', 'Extracting', 'Moving', 'Running', 'Whatever']
      .map(status => statusKind({ status }))
    expect(kinds).toEqual(['downloading', 'downloading', 'downloading', 'paused', 'queued', 'queued', 'queued', 'processing', 'processing', 'processing', 'processing', 'processing', 'processing'])
  })
  test('lead is the first downloading slot, else the first slot, else null; the pill needs downloading', () => {
    const items = buildQueueItems([slot('a', { status: 'Paused' }), slot('b'), slot('c')], {})
    expect(leadItem(items).key).toBe('b')
    expect(pillItem(items).key).toBe('b')
    const paused = buildQueueItems([slot('a', { status: 'Paused' }), slot('b', { status: 'Queued' })], {})
    expect(leadItem(paused).key).toBe('a')
    expect(pillItem(paused)).toBeNull()
    expect(leadItem([])).toBeNull()
  })
  test('row status lines and live status text', () => {
    expect(rowStatus('paused', 12)).toEqual({ text: 'Paused · 12%', tone: 'attn', bar: true })
    expect(rowStatus('downloading', 64)).toEqual({ text: '64%', tone: 'live', bar: true })
    expect(rowStatus('downloading', 0)).toEqual({ text: 'Queued', tone: 'muted', bar: false })
    expect(rowStatus('queued', 0).bar).toBe(false)
    expect(rowStatus('processing', 100)).toEqual({ text: 'Processing', tone: 'live', bar: true })
    const [item] = buildQueueItems([slot('a', { percentage: '64', timeleft: '0:01:10' })], {})
    expect(liveStatus(item)).toMatchObject({ label: 'Downloading', tileText: 'Downloading · 64%', detail: '64% · 1 min left', tone: 'live' })
    const [paused] = buildQueueItems([slot('a', { status: 'Paused', percentage: '12' })], {})
    expect(liveStatus(paused)).toMatchObject({ label: 'Paused', tileText: 'Paused · 12%', detail: '12%', tone: 'attn' })
    const [queued] = buildQueueItems([slot('a', { status: 'Queued', percentage: '0' })], {})
    expect(liveStatus(queued)).toMatchObject({ tileText: 'Queued', detail: null, tone: 'muted' })
  })
})
