import { test, expect, afterEach } from 'vitest'
import { radarrWindow, movieEntries, collapse, groupByDay } from '../../src/upcoming'

// Time-zone proof for the Radarr date rule (D2, D22). TZ is assigned inside the test (Node re-reads it) and restored after.
const NOW = Date.parse('2026-10-18T05:30:00.000Z')
const original = process.env.TZ
afterEach(() => { if (original === undefined) delete process.env.TZ; else process.env.TZ = original })

const CASES = [
  { zone: 'America/Los_Angeles', localNow: '2026-10-17', firstDay: '2026-10-16', lastDay: '2026-10-31',
    start: '2026-10-15T07:00:00.000Z', end: '2026-11-02T07:59:59.999Z', weekdays: ['Friday', 'Saturday'], episodeDay: '2026-10-17' },
  { zone: 'Pacific/Auckland', localNow: '2026-10-18', firstDay: '2026-10-17', lastDay: '2026-11-01',
    start: '2026-10-15T11:00:00.000Z', end: '2026-11-02T10:59:59.999Z', weekdays: ['Saturday', 'Sunday'], episodeDay: '2026-10-18' },
  { zone: 'UTC', localNow: '2026-10-18', firstDay: '2026-10-17', lastDay: '2026-11-01',
    start: '2026-10-16T00:00:00.000Z', end: '2026-11-02T23:59:59.999Z', weekdays: ['Saturday', 'Sunday'], episodeDay: '2026-10-18' },
]

function useZone(zone, localNow) {
  process.env.TZ = zone
  // Fail loudly if the zone did not apply.
  expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(zone)
  const date = new Date(NOW)
  const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  expect(day).toBe(localNow)
}
const movie = (id, digitalRelease) => ({ id, title: `Movie ${id}`, monitored: true, hasFile: false, isAvailable: true, digitalRelease })
const dayAfter = day => new Date(Date.parse(`${day}T00:00:00Z`) + 86400000).toISOString().slice(0, 10)
const dayBefore = day => new Date(Date.parse(`${day}T00:00:00Z`) - 86400000).toISOString().slice(0, 10)

for (const c of CASES) {
  test(`${c.zone}: padded window, edge releases kept by UTC date part, outside releases dropped (criterion 5)`, () => {
    useZone(c.zone, c.localNow)
    const span = radarrWindow(NOW)
    expect(span).toEqual({ start: c.start, end: c.end, firstDay: c.firstDay, lastDay: c.lastDay })
    const releases = [
      movie(1, `${c.firstDay}T00:00:00Z`), movie(2, `${c.lastDay}T00:00:00Z`),
      movie(3, `${dayBefore(c.firstDay)}T00:00:00Z`), movie(4, `${dayAfter(c.lastDay)}T00:00:00Z`),
    ]
    const entries = movieEntries(releases, span, NOW)
    expect(entries.map(e => [e.movieId, e.dayKey])).toEqual([[1, c.firstDay], [2, c.lastDay]])
    const days = groupByDay(entries, NOW)
    expect(days.map(d => d.date.toLocaleDateString('en-US', { weekday: 'long' }))).toEqual(c.weekdays)
    expect(days.map(d => d.date.getDate())).toEqual([Number(c.firstDay.slice(8)), Number(c.lastDay.slice(8))])
  })
  test(`${c.zone}: an episode keys to the local date while a release keys to its UTC date`, () => {
    useZone(c.zone, c.localNow)
    const [episode] = collapse([{ id: 1, seriesId: 1, seasonNumber: 1, episodeNumber: 1, title: 'E', airDateUtc: '2026-10-18T03:00:00Z', series: { id: 1, title: 'S' } }], NOW)
    expect(episode.dayKey).toBe(c.episodeDay)
    const [release] = movieEntries([movie(1, '2026-10-20T00:00:00Z')], radarrWindow(NOW), NOW)
    expect(release.dayKey).toBe('2026-10-20')
  })
}
