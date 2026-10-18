import React from 'react'
import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react'
import Dashboard from '../../src/components/Dashboard'
import Icon from '../../src/components/Icon'
import { availableTabs } from '../../src/sections'
import { entryLabel } from '../../src/upcoming'
import { reply, config, stubFetch, stubMedia, resetEnvironment, tmdb } from './modern-helpers'

// Fixed clock: Wednesday 2026-10-28 12:00 local. The window crosses a month end (Nov 1).
const NOW = new Date(2026, 9, 28, 12, 0)
const L = (month, day, hour) => new Date(2026, month - 1, day, hour).toISOString()
const U = (month, day) => `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T00:00:00Z`
const show = { id: 7, title: 'Fixture Show', images: [{ coverType: 'poster', remoteUrl: tmdb('show-poster.jpg') }, { coverType: 'fanart', remoteUrl: tmdb('show-fanart.jpg') }] }
const second = { id: 8, title: 'Second Show', images: [] }
const third = { id: 9, title: 'Third Show', images: [] }
const fourth = { id: 10, title: 'Fourth Show', images: [] }
const ep = (id, series, season, number, airDateUtc, extra = {}) =>
  ({ id, seriesId: series.id, seasonNumber: season, episodeNumber: number, title: `Episode ${number}`, airDateUtc, hasFile: false, series, ...extra })
const seasonDrop = Array.from({ length: 8 }, (_, i) => ep(100 + i, show, 3, i + 1, L(10, 29, 21),
  i === 0 ? { images: [{ coverType: 'screenshot', remoteUrl: 'https://img.invalid/still-100.jpg' }] } : {}))
const calendar = [
  ep(1, show, 2, 4, L(10, 27, 20)),
  ep(2, second, 1, 1, L(10, 28, 8), { hasFile: true, title: 'Done Already' }),
  ep(3, fourth, 1, 5, L(10, 28, 9)), ep(4, fourth, 1, 6, L(10, 28, 9), { hasFile: true }),
  ...seasonDrop,
  ...[1, 2, 4].map((n, i) => ep(200 + i, second, 2, n, L(10, 29, 21))),
  ep(300, third, 6, 6, L(11, 2, 20), { title: 'Judgment Day' }),
]
const film = (id, extra = {}) => ({ id, title: `Fixture Film ${id}`, monitored: true, hasFile: false, isAvailable: true,
  images: [{ coverType: 'poster', remoteUrl: tmdb(`film-${id}.jpg`) }], ...extra })
const radarrCalendar = [
  film(21, { digitalRelease: U(10, 30) }),
  film(22, { physicalRelease: U(11, 2), physicalReleaseNote: 'Steelbook edition' }),
  film(23, { digitalRelease: U(10, 28) }),
  film(24, { digitalRelease: U(10, 27), hasFile: true }),
  film(25, { inCinemas: U(10, 31), digitalRelease: U(2027, 3), title: 'Cinema Only Film' }),
]
const data = { calendar, radarrCalendar, capabilities: ['movieDelete', 'radarrCalendar'] }

let restoreMedia
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW)
  resetEnvironment(); restoreMedia = stubMedia({ phone: false }); window.scrollTo = vi.fn()
})
afterEach(() => { restoreMedia(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

const open = async (overrides = {}, payload = data, cfg = config, hash = '#/upcoming') => {
  const fn = stubFetch(overrides, payload)
  window.location.hash = hash
  const view = render(<Dashboard config={cfg} onConfigSaved={() => {}} />)
  await waitFor(() => expect(screen.queryByText('Loading upcoming…')).toBeNull())
  return { fn, ...view }
}
const iconPath = name => render(<Icon name={name} />).container.querySelector('path').getAttribute('d')
const hasIcon = (el, name) => [...el.querySelectorAll('svg path')].some(p => p.getAttribute('d') === iconPath(name))
const tile = name => screen.getByRole('link', { name })

test('the page has one h1, the subtitle, All/TV/Movies chips and Thumbnails pressed by default (criterion 9)', async () => {
  await open()
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  expect(screen.getByRole('heading', { level: 1, name: 'Upcoming' })).toBeInTheDocument()
  expect(screen.getByText('Yesterday through the next 14 days · local time')).toBeInTheDocument()
  const chips = screen.getByRole('group', { name: 'Show' })
  expect(within(chips).getAllByRole('button').map(b => b.textContent)).toEqual(['All', 'TV', 'Movies'])
  expect(within(chips).getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true')
  const views = screen.getByRole('group', { name: 'View' })
  expect(within(views).getByRole('button', { name: 'Thumbnails' })).toHaveAttribute('aria-pressed', 'true')
  expect(within(views).getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'false')
})
test('filters hide the other kind, and filter and view persist across a reload (criterion 9, 14)', async () => {
  const first = await open()
  fireEvent.click(screen.getByRole('button', { name: 'TV' }))
  expect(document.querySelector('a[href^="#/movies/"]')).toBeNull()
  expect(document.querySelector('a[href^="#/shows/"]')).not.toBeNull()
  expect(localStorage.getItem('arrview.ui.v1.upcoming.filter')).toBe('"tv"')
  fireEvent.click(screen.getByRole('button', { name: 'Movies' }))
  expect(document.querySelector('a[href^="#/shows/"]')).toBeNull()
  expect(document.querySelector('a[href^="#/movies/"]')).not.toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'List' }))
  expect(localStorage.getItem('arrview.ui.v1.upcoming.view')).toBe('"list"')
  expect(screen.getByRole('button', { name: 'Movies' })).toHaveAttribute('aria-pressed', 'true')
  expect(document.querySelector('.m-ulist')).not.toBeNull()
  first.unmount()
  await open()
  expect(screen.getByRole('button', { name: 'Movies' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true')
})
test('invalid stored values fall back, and a single source shows no chips (criterion 9)', async () => {
  localStorage.setItem('arrview.ui.v1.upcoming.filter', '"sideways"'); localStorage.setItem('arrview.ui.v1.upcoming.view', '"grid"')
  const first = await open()
  expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('button', { name: 'Thumbnails' })).toHaveAttribute('aria-pressed', 'true')
  first.unmount()
  await open({}, data, { sonarr: config.sonarr })
  expect(screen.queryByRole('group', { name: 'Show' })).toBeNull()
  expect(screen.getByRole('group', { name: 'View' })).toBeInTheDocument()
  expect(document.querySelector('a[href^="#/movies/"]')).toBeNull()
})
test('a stored movies filter does not hide episodes when only Sonarr is configured', async () => {
  localStorage.setItem('arrview.ui.v1.upcoming.filter', '"movies"')
  await open({}, data, { sonarr: config.sonarr })
  expect(document.querySelector('a[href^="#/shows/"]')).not.toBeNull()
  expect(localStorage.getItem('arrview.ui.v1.upcoming.filter')).toBe('"movies"')
})

test('thumbnails: one drop tile with the stack badge, single episode with a time badge, movie release badges (criterion 10)', async () => {
  await open()
  const drop = tile(/^Fixture Show, season 3, episodes 1 to 8,/)
  expect(drop).toHaveClass('is-drop')
  expect(drop.querySelectorAll('.m-utile-title')).toHaveLength(1)
  expect(drop.querySelector('.m-utile-meta')).toHaveTextContent('S3 · Episodes 1–8')
  const badge = [...drop.querySelectorAll('.m-utile-badge')].find(b => b.textContent === '8 episodes')
  expect(hasIcon(badge, 'stack')).toBe(true)
  expect(screen.getAllByRole('link', { name: /^Fixture Show, season 3/ })).toHaveLength(1)
  const single = tile(/^Third Show, season 6, episode 6,/)
  expect(single.querySelector('.m-utile-meta')).toHaveTextContent('S6 E6 · Judgment Day')
  expect(single.querySelector('.m-utile-badge').textContent).toBe(new Date(L(11, 2, 20)).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }))
  const digital = tile(/^Fixture Film 21, movie, digital release/)
  expect(digital.querySelector('.m-utile-badge')).toHaveTextContent('Digital')
  expect(hasIcon(digital.querySelector('.m-utile-badge'), 'monitor-play')).toBe(true)
  expect(digital.querySelector('.m-utile-meta')).toHaveTextContent('Movie · Digital release')
  const physical = tile(/^Fixture Film 22, movie, physical release/)
  expect(physical.querySelector('.m-utile-badge')).toHaveTextContent('Physical')
  expect(hasIcon(physical.querySelector('.m-utile-badge'), 'disc')).toBe(true)
  expect(physical.querySelector('.m-utile-meta')).toHaveTextContent('Movie · Physical release · Steelbook edition')
  expect(physical.querySelector('.m-utile-blur')).toHaveAttribute('aria-hidden', 'true')
})
test('status badges: Downloaded with a check, Missing, N of M, none before air time; movies only Downloaded or Missing (criterion 10)', async () => {
  await open()
  const statusOf = el => [...el.querySelectorAll('.m-utile-badge')].map(b => b.textContent).filter(t => /Downloaded|Missing| of /.test(t))
  expect(statusOf(tile(/^Second Show, season 1, episode 1,/))).toEqual(['Downloaded'])
  const done = [...tile(/^Second Show, season 1, episode 1,/).querySelectorAll('.m-utile-badge')].find(b => b.textContent === 'Downloaded')
  expect(hasIcon(done, 'check')).toBe(true)
  expect(statusOf(tile(/^Fixture Show, season 2, episode 4,/))).toEqual(['Missing'])
  expect(statusOf(tile(/^Fourth Show, season 1, episodes 5 to 6,/))).toEqual(['1 of 2'])
  expect(statusOf(tile(/^Fixture Show, season 3, episodes 1 to 8,/))).toEqual([])
  expect(statusOf(tile(/^Third Show, season 6, episode 6,/))).toEqual([])
  expect(statusOf(tile(/^Fixture Film 23, movie/))).toEqual(['Missing'])
  expect(statusOf(tile(/^Fixture Film 24, movie/))).toEqual(['Downloaded'])
  expect(statusOf(tile(/^Fixture Film 21, movie/))).toEqual([])
  for (const badge of document.querySelectorAll('.m-utile-badge')) expect(badge.textContent.trim().length).toBeGreaterThan(0)
})
test('cinema dates never show: the cinema-only movie is absent and no inCinemas value is rendered (criterion 22)', async () => {
  await open()
  expect(screen.queryByText(/Cinema Only Film/)).toBeNull()
  expect(document.body.textContent).not.toMatch(/2026-10-31|Oct 31/)
})

test('day column: month label on the first day and where the month changes, Today/Tomorrow/Yesterday, empty days skipped (criterion 11)', async () => {
  await open()
  const days = [...document.querySelectorAll('.m-agenda-day')]
  const text = (day, part) => day.querySelector(`.m-agenda-${part}`).textContent
  const month = date => date.toLocaleDateString(undefined, { month: 'short' })
  expect(days.map(d => text(d, 'num'))).toEqual(['27', '28', '29', '30', '2'])
  expect(days.map(d => text(d, 'month'))).toEqual([month(new Date(2026, 9, 27)), '', '', '', month(new Date(2026, 10, 2))])
  expect(days.map(d => text(d, 'rel'))).toEqual(['Yesterday', 'Today', 'Tomorrow', '', ''])
  expect(days[0]).toHaveClass('is-past')
  expect(days[1]).toHaveClass('is-today')
  expect(days.filter(d => d.classList.contains('is-today'))).toHaveLength(1)
  expect(text(days[2], 'weekday')).toBe(new Date(2026, 9, 29).toLocaleDateString(undefined, { weekday: 'short' }))
  expect(days.map(d => d.querySelector('h2').textContent)).not.toContain('')
})
test('movies sort before episodes inside a day and the digital release shares its day section (D7)', async () => {
  await open()
  const today = document.querySelector('.m-agenda-day.is-today')
  expect([...today.querySelectorAll('.m-utile-title')].map(el => el.textContent)).toEqual(['Fixture Film 23', 'Second Show', 'Fourth Show'])
})

test('links: one anchor per entry with the right href and the exact accessible name, no interactive descendants (criterion 15)', async () => {
  await open()
  const drop = tile(/^Fixture Show, season 3, episodes 1 to 8,/)
  expect(drop).toHaveAttribute('href', '#/shows/7')
  expect(drop.getAttribute('aria-label')).toMatch(new RegExp(`^Fixture Show, season 3, episodes 1 to 8, ${new Date(L(10, 29, 21)).toLocaleDateString(undefined, { weekday: 'long' })} `))
  expect(tile(/^Second Show, season 2, 3 episodes,/)).toHaveAttribute('href', '#/shows/8')
  expect(tile(/^Fixture Film 21, movie, digital release, /)).toHaveAttribute('href', '#/movies/21')
  expect(tile(/^Fixture Film 22, movie, physical release, /)).toHaveAttribute('href', '#/movies/22')
  for (const link of document.querySelectorAll('.m-agenda a')) expect(link.querySelectorAll('a, button, input, select, [tabindex]')).toHaveLength(0)
  const film = tile(/^Fixture Film 21/)
  expect(film.getAttribute('aria-label')).toBe(`Fixture Film 21, movie, digital release, ${new Date(2026, 9, 30).toLocaleDateString(undefined, { weekday: 'long' })}`)
})
test('an entry without a series id renders as a plain block, not a link', async () => {
  const orphan = { id: 900, seasonNumber: 1, episodeNumber: 1, title: 'Orphan', airDateUtc: L(10, 29, 18), hasFile: false, series: { title: 'Nameless Show' } }
  await open({}, { ...data, calendar: [orphan], radarrCalendar: [] })
  const block = document.querySelector('.m-utile')
  expect(block.tagName).toBe('DIV')
  expect(block).toHaveTextContent('Nameless Show')
})
test('art chains: still -> fanart -> poster -> placeholder; a broken movie poster shows the placeholder; TMDB art is resized, stills are not (criterion 13)', async () => {
  await open()
  const box = tile(/^Fixture Show, season 3, episodes 1 to 8,/).querySelector('.m-utile-box')
  const src = () => box.querySelector('img')?.getAttribute('src')
  expect(src()).toBe('https://img.invalid/still-100.jpg')
  fireEvent.error(box.querySelector('img'))
  expect(src()).toBe('https://image.tmdb.org/t/p/w780/show-fanart.jpg')
  fireEvent.error(box.querySelector('img'))
  expect(src()).toBe('https://image.tmdb.org/t/p/w342/show-poster.jpg')
  fireEvent.error(box.querySelector('img'))
  expect(box.querySelector('img')).toBeNull()
  expect(box.querySelector('.m-art-empty')).not.toBeNull()
  const movieBox = tile(/^Fixture Film 21/).querySelector('.m-utile-box')
  expect(movieBox.querySelector('.m-utile-poster img').getAttribute('src')).toBe('https://image.tmdb.org/t/p/w342/film-21.jpg')
  fireEvent.error(movieBox.querySelector('.m-utile-poster img'))
  fireEvent.error(movieBox.querySelector('.m-utile-blur'))
  expect(movieBox.querySelector('img')).toBeNull()
  expect(movieBox.querySelector('.m-art-empty')).not.toBeNull()
})

test('list view: day headings, time or release word, thumbnail, subtitle and state (criterion 14)', async () => {
  localStorage.setItem('arrview.ui.v1.upcoming.view', '"list"')
  await open()
  const headings = [...document.querySelectorAll('.m-ulist-day')].map(h => h.textContent)
  const long = date => date.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
  expect(headings).toEqual([`Yesterday ${long(new Date(2026, 9, 27))}`, `Today ${long(new Date(2026, 9, 28))}`, `Tomorrow ${long(new Date(2026, 9, 29))}`, long(new Date(2026, 9, 30)), long(new Date(2026, 10, 2))])
  const dropRow = tile(/^Fixture Show, season 3, episodes 1 to 8,/)
  expect(dropRow.querySelector('.m-ulist-time')).toHaveTextContent(new Date(L(10, 29, 21)).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }))
  expect(dropRow.querySelector('.m-ulist-text')).toHaveTextContent('Fixture ShowS3 · Episodes 1–8')
  expect(dropRow.querySelector('.m-ulist-thumb img').getAttribute('src')).toBe('https://image.tmdb.org/t/p/w342/show-poster.jpg')
  expect(dropRow.querySelector('.m-ulist-state')).toHaveTextContent('8 episodes')
  expect(hasIcon(dropRow.querySelector('.m-ulist-state'), 'stack')).toBe(true)
  const physical = tile(/^Fixture Film 22/)
  expect(physical.querySelector('.m-ulist-time')).toHaveTextContent('Physical')
  expect(hasIcon(physical.querySelector('.m-ulist-time'), 'disc')).toBe(true)
  expect(physical.querySelector('.m-ulist-text')).toHaveTextContent('Movie · Physical release · Steelbook edition')
  expect(tile(/^Second Show, season 1, episode 1,/).querySelector('.m-ulist-state')).toHaveTextContent('Downloaded')
  expect(hasIcon(tile(/^Second Show, season 1, episode 1,/).querySelector('.m-ulist-state'), 'check')).toBe(true)
  expect(tile(/^Fixture Show, season 2, episode 4,/).querySelector('.m-ulist-state')).toHaveTextContent('Missing')
  expect(tile(/^Fourth Show, season 1, episodes 5 to 6,/).querySelector('.m-ulist-state')).toHaveTextContent('1 of 2')
  fireEvent.click(screen.getByRole('button', { name: 'Thumbnails' }))
  expect(document.querySelector('.m-agenda')).not.toBeNull()
})

test('states: loading text first, then the empty text; the empty text is not shown while a source fails (criterion 16)', async () => {
  stubFetch({}, { ...data, calendar: [], radarrCalendar: [] })
  window.location.hash = '#/upcoming'
  render(<Dashboard config={config} onConfigSaved={() => {}} />)
  expect(screen.getByRole('status')).toHaveTextContent('Loading upcoming…')
  expect(screen.queryByRole('group', { name: 'Show' })).toBeNull()
  expect(screen.queryByRole('group', { name: 'View' })).toBeNull()
  expect(await screen.findByText('Nothing scheduled in this window')).toBeInTheDocument()
})
test('one source failing shows its alert and Retry above the other entries; Retry refetches only that service (criterion 16)', async () => {
  let up = false
  const { fn } = await open({ '/api/sonarr/calendar': () => (up ? reply(calendar) : reply({}, false)) })
  const alert = screen.getByRole('alert')
  expect(alert).toHaveTextContent('Cannot reach Sonarr')
  expect(screen.queryByText('Nothing scheduled in this window')).toBeNull()
  expect(document.querySelector('a[href^="#/movies/"]')).not.toBeNull()
  expect(alert.compareDocumentPosition(document.querySelector('.m-agenda')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'TV' }))
  expect(screen.getByRole('alert')).toBeInTheDocument()
  const calls = prefix => fn.calls.filter(c => c.url.startsWith(prefix)).length
  const radarr = calls('/api/radarr/calendar'), sonarr = calls('/api/sonarr/calendar')
  up = true
  fireEvent.click(screen.getByRole('button', { name: 'Retry Sonarr upcoming' }))
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  expect(calls('/api/radarr/calendar')).toBe(radarr)
  expect(calls('/api/sonarr/calendar')).toBe(sonarr + 1)
  expect(document.querySelector('a[href^="#/shows/"]')).not.toBeNull()
})
test('both services failing shows two alerts and no empty text', async () => {
  await open({ '/api/sonarr/calendar': () => reply({}, false), '/api/radarr/calendar': () => reply({}, false) })
  expect(screen.getAllByRole('alert').map(a => a.textContent)).toEqual([expect.stringContaining('Cannot reach Sonarr'), expect.stringContaining('Cannot reach Radarr')])
  expect(screen.getByRole('button', { name: 'Retry Radarr upcoming' })).toBeInTheDocument()
  expect(screen.queryByText('Nothing scheduled in this window')).toBeNull()
})

test('phones: Upcoming uses the page header with the Settings gear; wide screens have no gear in the page (criterion 17)', async () => {
  restoreMedia(); restoreMedia = stubMedia({ phone: true })
  await open()
  const header = document.querySelector('.m-pageheader')
  expect(within(header).getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '#/settings')
  expect(document.querySelector('.m-gear-row')).toBeNull()
})
test('wide screens have only the top bar gear', async () => {
  await open()
  expect(screen.getAllByRole('link', { name: 'Settings' })).toHaveLength(1)
  expect(document.querySelector('.m-pageheader a[aria-label="Settings"]')).toBeNull()
})

test('accessibility: headings h1 > h2, every control named, artwork alt empty (criterion 18)', async () => {
  for (const view of ['thumbs', 'list']) {
    localStorage.setItem('arrview.ui.v1.upcoming.view', JSON.stringify(view))
    const { unmount } = await open()
    const levels = [...document.querySelectorAll('.m-main h1, .m-main h2, .m-main h3')].map(h => Number(h.tagName[1]))
    expect(levels[0]).toBe(1)
    expect(levels.filter(l => l === 1)).toHaveLength(1)
    expect(levels.slice(1).every(l => l === 2)).toBe(true)
    for (const el of document.querySelectorAll('.m-main button, .m-main a[href]')) expect(el).toHaveAccessibleName()
    for (const img of document.querySelectorAll('.m-main img')) expect(img.getAttribute('alt')).toBe('')
    for (const svg of document.querySelectorAll('.m-main svg')) expect(svg).toHaveAttribute('aria-hidden', 'true')
    unmount()
  }
})
test('the section is available with Sonarr or Radarr alone and not with neither (criterion 20)', async () => {
  expect(availableTabs({}).map(t => t.id)).not.toContain('upcoming')
  expect(availableTabs({ sonarr: config.sonarr }).map(t => t.id)).toContain('upcoming')
  expect(availableTabs({ radarr: config.radarr }).map(t => t.id)).toEqual(['upcoming', 'movies', 'settings'])
  expect(availableTabs({ radarr: { url: 'http://radarr.invalid' } }).map(t => t.id)).not.toContain('upcoming')
  await open({}, data, { radarr: config.radarr })
  expect(within(screen.getByRole('navigation', { name: 'Main navigation' })).getByRole('link', { name: 'Upcoming' })).toHaveAttribute('aria-current', 'page')
  expect(screen.queryByRole('group', { name: 'Show' })).toBeNull()
  expect(document.querySelector('a[href^="#/shows/"]')).toBeNull()
  expect(document.querySelector('a[href^="#/movies/"]')).not.toBeNull()
})

// ---- Classic ----
const classic = async (overrides = {}, payload = data) => {
  localStorage.setItem('arrview.ui.v1.layout', '"classic"'); localStorage.setItem('arrview.ui.v1.tab', '"upcoming"')
  stubFetch(overrides, payload)
  render(<Dashboard config={config} onConfigSaved={() => {}} />)
  await waitFor(() => expect(screen.queryByText('Loading upcoming…')).toBeNull())
}
const row = text => screen.getByText(text).closest('button.upcoming-row')
test('Classic stays a list: drop row, single episode text, movie rows, badge words, no chips or toggle (criterion 19, 22)', async () => {
  await classic()
  expect(screen.queryByRole('group', { name: 'Show' })).toBeNull()
  expect(screen.queryByRole('group', { name: 'View' })).toBeNull()
  expect(row('S3 · Episodes 1–8')).toHaveTextContent('Fixture Show')
  expect(screen.getAllByText('S3 · Episodes 1–8')).toHaveLength(1)
  expect(row('S02E04 · Episode 4')).toHaveTextContent('Missing')
  expect(row('S01E01 · Done Already')).toHaveTextContent('Downloaded')
  expect(row('S1 · Episodes 5–6')).toHaveTextContent('1 of 2')
  expect(row('S06E06 · Judgment Day')).toHaveTextContent('Upcoming')
  expect(row('S2 · 3 episodes')).toBeInTheDocument()
  expect(screen.getAllByText('Movie · Digital release').length).toBe(3)
  expect(row('Movie · Physical release · Steelbook edition')).toHaveTextContent('Fixture Film 22')
  expect(screen.queryByText(/Cinema Only Film/)).toBeNull()
  expect(document.querySelectorAll('.upcoming-row .media-poster').length).toBeGreaterThan(5)
  expect(screen.getAllByRole('heading', { level: 2 })[0]).toHaveTextContent(new Date(2026, 9, 27).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }))
})
test('Classic: an episode or drop row opens the Shows tab, a movie row opens the Movies tab (criterion 19)', async () => {
  await classic()
  fireEvent.click(row('S3 · Episodes 1–8'))
  await waitFor(() => expect(document.querySelector('.tab-btn.active')).toHaveAttribute('aria-label', 'Shows'))
  document.querySelector('.tab-upcoming').click()
  await screen.findAllByText('Movie · Digital release')
  fireEvent.click(screen.getAllByText('Movie · Digital release')[0].closest('button'))
  await waitFor(() => expect(document.querySelector('.tab-btn.active')).toHaveAttribute('aria-label', 'Movies'))
})
test('Classic: one source failing shows its error and Retry plus the other rows (criterion 19)', async () => {
  await classic({ '/api/radarr/calendar': () => reply({}, false) })
  expect(screen.getByRole('alert')).toHaveTextContent('Cannot reach Radarr')
  expect(screen.getByRole('button', { name: 'Retry Radarr upcoming' })).toBeInTheDocument()
  expect(row('S3 · Episodes 1–8')).toBeInTheDocument()
})
test('Classic: empty window text', async () => {
  await classic({}, { ...data, calendar: [], radarrCalendar: [] })
  expect(screen.getByText('Nothing scheduled in this window')).toBeInTheDocument()
})
