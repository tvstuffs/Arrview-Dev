import { test, expect } from 'vitest'
import { collapse, movieEntries, radarrWindow, calendarRange, groupByDay, entryLabel } from '../../src/upcoming'
import { calendarRange as tabCalendarRange, episodeStatus } from '../../src/components/UpcomingTab'

// Fixed local clock: 2026-10-17 12:00 in whatever zone the runner uses; every fixture time is built from local parts.
const NOW = new Date(2026, 9, 17, 12, 0).getTime()
const local = (day, hour, minute = 0, month = 9) => new Date(2026, month, day, hour, minute).toISOString()
const show = { id: 7, title: 'Fixture Show' }
const ep = (id, season, number, airDateUtc, extra = {}) =>
  ({ id, seriesId: 7, seasonNumber: season, episodeNumber: number, title: `Episode ${number}`, airDateUtc, hasFile: false, series: show, ...extra })
const drop = (season, count, airDateUtc, first = 1, base = season * 100) => Array.from({ length: count }, (_, i) => ep(base + i, season, first + i, airDateUtc))

test('calendarRange is shared with the Classic tab export and unchanged', () => {
  expect(tabCalendarRange).toBe(calendarRange)
  const range = calendarRange(new Date(2026, 8, 19, 12))
  expect(new Date(range.start).getDate()).toBe(18)
  expect(new Date(range.end).getDate()).toBe(3)
  expect(episodeStatus({ hasFile: false, airDateUtc: '2020-01-01' }, NOW)).toBe('Missing')
})

test('collapse: one series, one instant, contiguous numbers -> one drop titled with an en dash (criterion 1)', () => {
  const entries = collapse(drop(3, 8, local(18, 21)), NOW)
  expect(entries).toHaveLength(1)
  expect(entries[0]).toMatchObject({ kind: 'drop', count: 8, season: 3, seasons: [3], subtitle: 'S3 · Episodes 1–8', title: 'Fixture Show' })
  expect(entries[0].subtitle).toContain('–')
})
test('collapse: gaps and duplicates give the count form', () => {
  const gap = [1, 2, 4].map((n, i) => ep(10 + i, 3, n, local(18, 21)))
  expect(collapse(gap, NOW)[0].subtitle).toBe('S3 · 3 episodes')
  const duplicate = [1, 2, 2].map((n, i) => ep(20 + i, 3, n, local(18, 21)))
  expect(collapse(duplicate, NOW)[0].subtitle).toBe('S3 · 3 episodes')
})
test('collapse: different instants or different series stay separate', () => {
  expect(collapse([ep(1, 3, 1, local(18, 21)), ep(2, 3, 2, local(18, 22))], NOW)).toHaveLength(2)
  const other = ep(3, 3, 1, local(18, 21), { seriesId: 8, series: { id: 8, title: 'Other Show' } })
  expect(collapse([ep(1, 3, 1, local(18, 21)), other], NOW)).toHaveLength(2)
})
test('collapse: episodes of one series at one instant across seasons become one multi-season drop, never a range (criterion 1)', () => {
  const entries = collapse([ep(1, 2, 10, local(18, 21)), ...drop(3, 8, local(18, 21))], NOW)
  expect(entries).toHaveLength(1)
  expect(entries[0]).toMatchObject({ kind: 'drop', count: 9, seasons: [2, 3], season: 2, subtitle: 'S2, S3 · 9 episodes' })
  const looksContiguous = collapse([ep(1, 1, 2, local(18, 21)), ep(2, 2, 1, local(18, 21))], NOW)
  expect(looksContiguous[0].subtitle).toBe('S1, S2 · 2 episodes')
})
test('collapse: no series id is never collapsed, bad dates are dropped, a single episode keeps its kind and subtitle', () => {
  const orphan = id => ({ id, seasonNumber: 1, episodeNumber: id, title: 'Orphan', airDateUtc: local(18, 21), hasFile: false })
  expect(collapse([orphan(1), orphan(2)], NOW)).toHaveLength(2)
  expect(collapse([ep(1, 1, 1, 'not a date'), ep(2, 1, 2, undefined)], NOW)).toEqual([])
  const [single] = collapse([ep(5, 6, 6, local(18, 21), { title: 'Judgment Day' })], NOW)
  expect(single).toMatchObject({ kind: 'episode', subtitle: 'S6 E6 · Judgment Day', count: 1 })
  expect(collapse([ep(5, 6, 6, local(18, 21), { title: '' })], NOW)[0].subtitle).toBe('S6 E6')
})
test('collapse: a drop sorts its episodes by season then number and day keys are local dates', () => {
  const [entry] = collapse([ep(2, 3, 2, local(18, 23, 30)), ep(1, 3, 1, local(18, 23, 30))], NOW)
  expect(entry.episodeNumbers).toEqual([1, 2])
  expect(entry.dayKey).toBe('2026-10-18')
})

test('status: drops and episodes (criterion 2)', () => {
  const aired = local(16, 21), later = local(20, 21)
  const status = list => collapse(list, NOW).map(e => [e.status, e.done, e.count])
  expect(status(drop(3, 3, aired).map(e => ({ ...e, hasFile: true })))).toEqual([['downloaded', 3, 3]])
  const mixed = drop(3, 4, aired); mixed[0].hasFile = mixed[1].hasFile = true
  expect(status(mixed)).toEqual([['partial', 2, 4]])
  expect(status(drop(3, 4, aired))).toEqual([['missing', 0, 4]])
  expect(status(drop(3, 4, later))).toEqual([[null, 0, 4]])
  const partialFuture = drop(3, 2, later); partialFuture[0].hasFile = true
  expect(status(partialFuture)).toEqual([[null, 1, 2]])
  expect(status([ep(1, 1, 1, aired, { hasFile: true }), ep(2, 1, 1, local(16, 22))])).toEqual([['downloaded', 1, 1], ['missing', 0, 1]])
})

const span = radarrWindow(NOW)
const movie = (id, extra = {}) => ({ id, title: `Movie ${id}`, monitored: true, hasFile: false, isAvailable: true, ...extra })

test('radarr entries: digital and physical on different days give two entries; the same day gives one digital (criterion 3)', () => {
  const split = movieEntries([movie(1, { digitalRelease: '2026-10-20T00:00:00Z', physicalRelease: '2026-10-25T00:00:00Z' })], span, NOW)
  expect(split.map(e => [e.release, e.dayKey])).toEqual([['digital', '2026-10-20'], ['physical', '2026-10-25']])
  const same = movieEntries([movie(1, { digitalRelease: '2026-10-20T00:00:00Z', physicalRelease: '2026-10-20T00:00:00Z' })], span, NOW)
  expect(same.map(e => e.release)).toEqual(['digital'])
})
test('radarr entries: physical note, cinema dates ignored, one date outside the window (criterion 3, 22)', () => {
  const [physical] = movieEntries([movie(1, { physicalRelease: '2026-10-25T00:00:00Z', physicalReleaseNote: 'Collector edition' })], span, NOW)
  expect(physical).toMatchObject({ release: 'physical', note: 'Collector edition', subtitle: 'Movie · Physical release · Collector edition' })
  expect(movieEntries([movie(2, { inCinemas: '2026-10-20T00:00:00Z', digitalRelease: '2027-03-01T00:00:00Z' })], span, NOW)).toEqual([])
  const partial = movieEntries([movie(3, { digitalRelease: '2026-01-01T00:00:00Z', physicalRelease: '2026-10-22T00:00:00Z' })], span, NOW)
  expect(partial.map(e => e.release)).toEqual(['physical'])
  expect(partial[0].note).toBeNull()
  expect(partial[0].subtitle).toBe('Movie · Physical release')
  expect(movieEntries([movie(4, { digitalRelease: 'garbage' })], span, NOW)).toEqual([])
})
test('radarr status: file, missing only when released, monitored and available (criterion 2)', () => {
  const status = extra => movieEntries([movie(1, { digitalRelease: '2026-10-16T00:00:00Z', ...extra })], span, NOW)[0].status
  expect(status({ hasFile: true })).toBe('downloaded')
  expect(status({})).toBe('missing')
  expect(status({ monitored: false })).toBeNull()
  expect(status({ isAvailable: false })).toBeNull()
  expect(movieEntries([movie(1, { digitalRelease: '2026-10-18T00:00:00Z' })], span, NOW)[0].status).toBeNull()
  expect(movieEntries([movie(1, { digitalRelease: '2026-10-17T00:00:00Z' })], span, NOW)[0].status).toBe('missing')
})

test('radarrWindow pads the request by a day and keeps firstDay..lastDay (criterion 4)', () => {
  const result = radarrWindow(NOW)
  expect(result).toMatchObject({ firstDay: '2026-10-16', lastDay: '2026-10-31' })
  expect(new Date(result.start).getTime()).toBe(new Date(2026, 9, 15).getTime())
  expect(new Date(result.end).getTime()).toBe(new Date(2026, 10, 1, 23, 59, 59, 999).getTime())
})

test('groupByDay: ascending days, relative labels, movies before episodes (criterion 8)', () => {
  const entries = [
    ...collapse([ep(1, 1, 1, local(18, 21)), ep(2, 1, 1, local(18, 9), { seriesId: 9, series: { id: 9, title: 'Early Show' } })], NOW),
    ...collapse([ep(3, 1, 1, local(16, 20))], NOW),
    ...collapse([ep(4, 1, 1, local(17, 20))], NOW),
    ...collapse([ep(5, 1, 1, local(25, 20))], NOW),
    ...movieEntries([movie(1, { digitalRelease: '2026-10-18T00:00:00Z', physicalRelease: '2026-10-25T00:00:00Z' })], span, NOW),
  ]
  const days = groupByDay(entries, NOW)
  expect(days.map(d => [d.dayKey, d.relative])).toEqual([['2026-10-16', 'yesterday'], ['2026-10-17', 'today'], ['2026-10-18', 'tomorrow'], ['2026-10-25', null]])
  expect(days[2].entries.map(e => e.title)).toEqual(['Movie 1', 'Early Show', 'Fixture Show'])
  expect(days[3].entries.map(e => e.kind)).toEqual(['movie', 'episode'])
  expect(days[0].date.getDate()).toBe(16)
})

test('entryLabel follows the accessible-name forms (D16)', () => {
  const when = new Date(2026, 9, 22, 21, 0)
  const weekday = when.toLocaleDateString(undefined, { weekday: 'long' })
  const time = when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  const [contiguous] = collapse(drop(3, 8, when.toISOString()), NOW)
  expect(entryLabel(contiguous)).toBe(`Fixture Show, season 3, episodes 1 to 8, ${weekday} ${time}`)
  const [gap] = collapse([1, 2, 4].map((n, i) => ep(30 + i, 3, n, when.toISOString())), NOW)
  expect(entryLabel(gap)).toBe(`Fixture Show, season 3, 3 episodes, ${weekday} ${time}`)
  const [multi] = collapse([ep(1, 2, 10, when.toISOString()), ep(2, 3, 1, when.toISOString())], NOW)
  expect(entryLabel(multi)).toBe(`Fixture Show, seasons 2, 3, 2 episodes, ${weekday} ${time}`)
  const [single] = collapse([ep(9, 1, 2, when.toISOString(), { hasFile: true })], NOW)
  expect(entryLabel(single)).toBe(`Fixture Show, season 1, episode 2, ${weekday} ${time}, Downloaded`)
  const [partial] = collapse(drop(3, 4, local(16, 21)).map((e, i) => ({ ...e, hasFile: i < 2 })), NOW)
  expect(entryLabel(partial)).toMatch(/, 2 of 4 downloaded$/)
  const [film] = movieEntries([movie(1, { digitalRelease: '2026-10-22T00:00:00Z' })], span, NOW)
  expect(entryLabel(film)).toBe(`Movie 1, movie, digital release, ${new Date(2026, 9, 22).toLocaleDateString(undefined, { weekday: 'long' })}`)
})
