import React from 'react'
import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, fireEvent, waitFor, act } from '@testing-library/react'
import Dashboard from '../../src/components/Dashboard'
import DownloadsPage from '../../src/components/modern/DownloadsPage.jsx'
import { LibraryProvider } from '../../src/components/modern/LibraryProvider.jsx'
import { DownloadsProvider, useDownloadNeeds } from '../../src/hooks/useDownloads.jsx'
import { collapse, sortEntries, entryLabel } from '../../src/upcoming'
import { reply, config, stubFetch, stubMedia, resetEnvironment, series as librarySeries, movies as libraryMovies, episodes as libraryEpisodes } from './modern-helpers'

const NOW = Date.parse('2026-03-18T15:00:00Z')
const secondsAgo = ms => Math.floor((NOW - ms) / 1000)
const MIN = 60000, DAYMS = 86400000
const SHOW_RELEASE = 'Fixture.Show.Name.S02E05.2160p.WEB-DL.DV.HDR.Atmos.x265-GRP'
const FILM_RELEASE = 'Fixture.Film.Title.2023.1080p.BluRay.x264-GRP'
const MUSIC_RELEASE = 'Fixture.Artist-Fixture.Album-FLAC-24bit-GRP'
const img = (coverType, remoteUrl) => ({ coverType, remoteUrl })
const FANART = 'https://img.invalid/show-fanart.jpg', POSTER = 'https://img.invalid/show-poster.jpg'
const SHOW = { id: 7, title: 'Fixture Show', year: 2020, images: [img('poster', POSTER), img('fanart', FANART)] }
const FILM = { id: 9, title: 'Fixture Film', year: 2023, images: [img('poster', 'https://img.invalid/film-poster.jpg'), img('fanart', 'https://img.invalid/film-fanart.jpg')] }
const CAPS = ['sonarrQueue', 'radarrQueue', 'radarrCalendar', 'movieDelete']

const slot = (id, extra = {}) => ({ nzo_id: id, filename: `Release.${id}`, status: 'Downloading', percentage: '64', mb: '9216', mbleft: '3277', timeleft: '0:01:10', cat: 'tv', ...extra })
const queueOf = (slots, extra = {}) => ({ queue: { status: 'Downloading', kbpersec: '48230', timeleft: '0:20:00', noofslots: slots.length, slots, ...extra } })
const sonarrRecord = (downloadId, extra = {}) => ({ downloadId, seriesId: 7, episodeId: 70, series: SHOW, episode: { id: 70, seasonNumber: 2, episodeNumber: 5, title: 'Fixture episode' }, quality: { name: 'WEBDL-2160p' }, ...extra })
const radarrRecord = (downloadId, movie = FILM, extra = {}) => ({ downloadId, movieId: movie.id, movie, quality: { name: 'Bluray-1080p' }, ...extra })
const envelope = records => ({ page: 1, pageSize: 100, totalRecords: records.length, records })

function world({ slots = [], queueExtra, sonarr = [], radarr = [], history = [], total, overrides = {}, data = {} } = {}) {
  return stubFetch({
    '/api/sabnzbd/history': url => reply({ history: { slots: history, noofslots: total ?? history.length } }),
    ...overrides,
  }, { capabilities: CAPS, queue: queueOf(slots, queueExtra), sonarrQueue: envelope(sonarr), radarrQueue: envelope(radarr), series: [SHOW], movies: [FILM], ...data })
}
const only = (cfg, ...names) => Object.fromEntries(names.map(name => [name, cfg[name]]))
function page({ phone = false, canSearch = true, cfg = config, onToast = vi.fn() } = {}) {
  const result = render(<LibraryProvider><DownloadsProvider config={cfg}><DownloadsPage config={cfg} phone={phone} onToast={onToast} canSearch={canSearch} /></DownloadsProvider></LibraryProvider>)
  return { ...result, onToast }
}
const posts = fn => fn.calls.filter(call => call.url === '/api/sabnzbd/action').map(call => JSON.parse(call.init.body))
const requests = (fn, prefix) => fn.calls.filter(call => call.url.startsWith(prefix)).length
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }

// Only Date is faked, so waitFor and the real timers keep working. Tests that read the shared fixtures' own dates keep the real clock.
const fixClock = () => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW) }
let restoreMedia
const originalZone = process.env.TZ
beforeEach(() => {
  process.env.TZ = 'UTC'
  expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('UTC')
  resetEnvironment(); restoreMedia = stubMedia({ phone: false }); window.scrollTo = vi.fn()
})
afterEach(() => {
  restoreMedia(); vi.useRealTimers(); vi.unstubAllGlobals()
  if (originalZone === undefined) delete process.env.TZ; else process.env.TZ = originalZone
})

// ---- Navigating to Downloads after the pill latched ready (criterion 22) ----
function PillNeed() { useDownloadNeeds({ sab: true }); return null }
test('navigating to Downloads from another wide route shows only the loading state until the arr answers, never unmatched items (criterion 22)', async () => {
  const gate = deferred()
  const fn = world({ slots: [slot('ep1', { filename: SHOW_RELEASE })], sonarr: [sonarrRecord('ep1')],
    overrides: { '/api/sonarr/queue': async () => { await gate.promise; return reply(envelope([sonarrRecord('ep1')])) } } })
  const tree = onDownloads => <LibraryProvider><DownloadsProvider config={config}><PillNeed />{onDownloads && <DownloadsPage config={config} phone={false} onToast={vi.fn()} canSearch />}</DownloadsProvider></LibraryProvider>
  const { rerender } = render(tree(false))
  await waitFor(() => expect(requests(fn, '/api/sabnzbd/queue')).toBeGreaterThan(0))
  await act(async () => { await new Promise(done => setTimeout(done, 50)) })
  expect(requests(fn, '/api/sonarr/queue')).toBe(0)
  rerender(tree(true))
  await screen.findByText('Loading downloads…')
  await waitFor(() => expect(requests(fn, '/api/sonarr/queue')).toBeGreaterThan(0))
  await act(async () => { await new Promise(done => setTimeout(done, 50)) })
  expect(screen.getByText('Loading downloads…')).toBeInTheDocument()
  expect(screen.queryByText(SHOW_RELEASE)).toBeNull()
  expect(screen.queryByText('Not in Sonarr')).toBeNull()
  gate.resolve()
  expect(await screen.findByRole('heading', { level: 2, name: 'Fixture Show' })).toBeInTheDocument()
  expect(screen.queryByText('Loading downloads…')).toBeNull()
})

// ---- Hero (criteria 14 to 16) ----
test('hero, matched episode: fanart hero with the eyebrow, link, subtitle, quality, progress and actions (criterion 14)', async () => {
  world({ slots: [slot('ep1', { filename: SHOW_RELEASE })], sonarr: [sonarrRecord('ep1')] })
  const { container } = page()
  const title = await screen.findByRole('heading', { level: 2, name: 'Fixture Show' })
  expect(within(title).getByRole('link')).toHaveAttribute('href', '#/shows/7')
  const hero = container.querySelector('.m-dl-hero')
  expect(hero).toHaveClass('is-fanart')
  expect(hero.querySelector('.m-hero-art img')).toHaveAttribute('src', FANART)
  expect(container.querySelector('.m-ambient')).toHaveAttribute('src', FANART)
  expect(within(hero).getByText('Downloading')).toBeInTheDocument()
  expect(hero.querySelector('.m-live-dot')).not.toBeNull()
  expect(within(hero).getByText('Season 2, Episode 5 · Fixture episode')).toBeInTheDocument()
  expect(within(hero).getByText('4K · Dolby Vision · HDR · Atmos')).toBeInTheDocument()
  const bar = within(hero).getByRole('progressbar', { name: 'Download progress' })
  expect(bar).toHaveAttribute('aria-valuenow', '64')
  expect(bar).toHaveAttribute('aria-valuemin', '0'); expect(bar).toHaveAttribute('aria-valuemax', '100')
  expect(bar).toHaveAttribute('aria-valuetext', '64%, 5.8 GB of 9.0 GB')
  expect(within(hero).getByText('64% · 5.8 GB of 9.0 GB')).toBeInTheDocument()
  expect(within(hero).getByText('1 min left')).toBeInTheDocument()
  expect(within(hero).getByRole('button', { name: 'Pause' })).toBeInTheDocument()
  expect(within(hero).getByRole('button', { name: 'Remove from SABnzbd Queue' })).toBeInTheDocument()
  expect(within(hero).queryByText(SHOW_RELEASE)).toBeNull()
})
test('hero, movie: fanart, poster only (beside the text over an ambient copy) or the film glyph (criterion 15)', async () => {
  const withArt = images => ({ ...FILM, images })
  const cases = [
    [FILM, 'is-fanart'],
    [withArt([img('poster', 'https://img.invalid/only-poster.jpg')]), 'is-poster'],
    [withArt([]), 'is-glyph'],
  ]
  for (const [movie, variant] of cases) {
    world({ slots: [slot('mv1', { filename: FILM_RELEASE, cat: 'movies' })], radarr: [radarrRecord('mv1', movie)] })
    const { container, unmount } = page()
    await screen.findByRole('heading', { level: 2, name: 'Fixture Film' })
    const hero = container.querySelector('.m-dl-hero')
    expect(hero).toHaveClass(variant)
    expect(within(hero).getByText('2023 · Movie')).toBeInTheDocument()
    if (variant === 'is-poster') {
      expect(hero.querySelector('.m-dl-hero-poster img')).toHaveAttribute('src', 'https://img.invalid/only-poster.jpg')
      expect(container.querySelector('.m-ambient')).toHaveAttribute('src', 'https://img.invalid/only-poster.jpg')
    }
    if (variant === 'is-glyph') {
      expect(within(hero).getByRole('img', { name: 'Movie' })).toBeInTheDocument()
      expect(container.querySelector('.m-ambient')).toBeNull()
      expect(hero.querySelectorAll('img')).toHaveLength(0)
    }
    unmount()
  }
})
test('a broken fanart falls to the poster and then to the placeholder, never a broken image (criterion 15)', async () => {
  world({ slots: [slot('ep1')], sonarr: [sonarrRecord('ep1')] })
  const { container } = page()
  await screen.findByRole('heading', { level: 2, name: 'Fixture Show' })
  fireEvent.error(container.querySelector('.m-hero-art img'))
  expect(container.querySelector('.m-hero-art img')).toHaveAttribute('src', POSTER)
  fireEvent.error(container.querySelector('.m-hero-art img'))
  expect(container.querySelector('.m-hero-art img')).toBeNull()
  expect(container.querySelector('.m-hero-art .m-art-empty')).not.toBeNull()
})
test('hero, unmatched: a music slot has a glyph tile, tidied name, quality, exact release name and never artwork; a TV-looking name says Not in Sonarr (criterion 16)', async () => {
  world({ slots: [slot('mu1', { filename: MUSIC_RELEASE, cat: 'music', percentage: '30' })] })
  const { container, unmount } = page()
  const title = await screen.findByRole('heading', { level: 2, name: 'Fixture Artist-Fixture Album' })
  const hero = container.querySelector('.m-dl-hero')
  expect(hero).toHaveClass('is-glyph')
  expect(within(hero).getByRole('img', { name: 'Music' })).toBeInTheDocument()
  expect(within(title).queryByRole('link')).toBeNull()
  expect(within(hero).getByText('Music')).toBeInTheDocument()
  expect(within(hero).getByText('FLAC · 24-bit')).toBeInTheDocument()
  expect(hero.querySelector('.m-dl-release')).toHaveTextContent(MUSIC_RELEASE)
  expect(within(hero).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '30')
  expect(within(hero).getByRole('button', { name: 'Pause' })).toBeInTheDocument()
  expect(container.querySelectorAll('img')).toHaveLength(0)
  unmount()

  world({ slots: [slot('tv1', { filename: SHOW_RELEASE })] })
  page()
  await screen.findByRole('heading', { level: 2, name: 'Fixture Show Name' })
  expect(await screen.findByText('Not in Sonarr')).toBeInTheDocument()
  expect(document.querySelectorAll('.m-dl-hero img')).toHaveLength(0)
})
test('a case-mismatched downloadId is listed as unmatched', async () => {
  world({ slots: [slot('SABnzbd_nzo_AbC', { filename: SHOW_RELEASE })], sonarr: [sonarrRecord('SABnzbd_NZO_ABC')] })
  page()
  await screen.findByRole('heading', { level: 2, name: 'Fixture Show Name' })
  expect(screen.queryByRole('link', { name: 'Fixture Show' })).toBeNull()
})

// ---- Queue (criteria 17, 18) ----
function richQueue() {
  const pack = Array.from({ length: 8 }, (_, i) => sonarrRecord('pk', { episodeId: 300 + i, episode: { id: 300 + i, seasonNumber: 3, episodeNumber: i + 1, title: `P${i + 1}` } }))
  return world({
    slots: [slot('lead', { filename: SHOW_RELEASE }), slot('pk', { filename: 'Fixture.Show.S03.2160p-GRP', status: 'Paused', percentage: '12', mb: '2048' }),
      slot('mu1', { filename: MUSIC_RELEASE, cat: 'music', percentage: '64', mb: '512' }), slot('qd', { filename: 'Fixture.Software.Setup.x64', cat: 'software', status: 'Queued', percentage: '0', mb: '300' })],
    sonarr: [sonarrRecord('lead'), ...pack],
    history: [], overrides: { '/api/sabnzbd/action': () => reply({ status: true }) },
  })
}
test('queue: header, count and time left, rows with thumbnail or glyph, status lines, quality, size and named buttons (criterion 17)', async () => {
  richQueue()
  const { container } = page()
  await screen.findByRole('heading', { level: 2, name: 'Fixture Show' })
  const section = screen.getByRole('heading', { level: 2, name: 'Queue' }).closest('section')
  expect(within(section).getByText('4 items · 20 min left')).toBeInTheDocument()
  const rows = [...section.querySelectorAll('li.m-dl-row')]
  expect(rows).toHaveLength(3)
  const [pack, music, queued] = rows
  expect(within(pack).getByText('S3 · Episodes 1–8')).toBeInTheDocument()
  expect(within(pack).getByText('Paused · 12%')).toBeInTheDocument()
  expect(within(pack).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '12')
  expect(pack.querySelector('.m-live-bar')).toHaveClass('is-attn')
  expect(pack.querySelector('img')).not.toBeNull()
  expect(within(music).getByRole('img', { name: 'Music' })).toBeInTheDocument()
  expect(within(music).getByText('64%')).toBeInTheDocument()
  expect(within(music).getByText('FLAC · 24-bit')).toBeInTheDocument()
  expect(within(music).getByText('512 MB')).toBeInTheDocument()
  expect(within(queued).getByText('Queued')).toBeInTheDocument()
  expect(within(queued).queryByRole('progressbar')).toBeNull()
  expect(within(queued).getByRole('img', { name: 'Software' })).toBeInTheDocument()
  expect(within(queued).getAllByText('Software')).toHaveLength(2)
  expect(within(pack).getByRole('link', { name: 'Fixture Show' })).toHaveAttribute('href', '#/shows/7')
  expect(pack.querySelector('.m-dl-row-title')).toHaveAttribute('title', 'Fixture.Show.S03.2160p-GRP')
  expect(within(pack).getByRole('button', { name: 'Resume' })).toHaveAccessibleDescription('Fixture Show')
  expect(within(music).getByRole('button', { name: 'Pause' })).toHaveAccessibleDescription('Fixture Artist-Fixture Album')
  expect(within(music).getByRole('button', { name: 'Remove from SABnzbd Queue' })).toHaveAccessibleDescription('Fixture Artist-Fixture Album')
  expect(container.querySelector('.m-dl-iconbtn')).toHaveClass('btn', 'btn-icon')
})
test('queue header buttons: Pause All or Resume All by status, Search NZBs only with NZBHydra, none of them with an empty queue (criterion 17)', async () => {
  world({ slots: [slot('a'), slot('b')] })
  page()
  await screen.findByRole('button', { name: 'Pause All' })
  expect(screen.queryByRole('button', { name: 'Resume All' })).toBeNull()
  expect(screen.getByRole('link', { name: 'Search NZBs' })).toHaveAttribute('href', '#/search')
  document.body.innerHTML = ''
})
test('queue header: a paused queue offers Resume All, singular item count, the note for a lone hero item, no Search without NZBHydra (criterion 17)', async () => {
  world({ slots: [slot('only', { status: 'Paused' })], queueExtra: { status: 'Paused', timeleft: '0:00:00' } })
  page({ canSearch: false })
  await screen.findByRole('button', { name: 'Resume All' })
  expect(screen.getByText('1 item')).toBeInTheDocument()
  expect(screen.getByText('Nothing else is queued.')).toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'Search NZBs' })).toBeNull()
  expect(screen.getByText('Paused')).toBeInTheDocument()
})
test('actions post the Classic bodies, Remove asks first and posts once, and every action refreshes the queue (criterion 18)', async () => {
  const fn = richQueue()
  const { onToast } = page()
  await screen.findByRole('heading', { level: 2, name: 'Fixture Show' })
  const queueCalls = () => requests(fn, '/api/sabnzbd/queue')
  const before = queueCalls()
  fireEvent.click(screen.getByRole('button', { name: 'Pause All' }))
  await waitFor(() => expect(posts(fn)).toEqual([{ mode: 'pause' }]))
  await waitFor(() => expect(queueCalls()).toBeGreaterThan(before))
  const music = screen.getByRole('heading', { level: 2, name: 'Queue' }).closest('section').querySelectorAll('li.m-dl-row')[1]
  fireEvent.click(within(music).getByRole('button', { name: 'Pause' }))
  await waitFor(() => expect(posts(fn)).toContainEqual({ mode: 'pause', nzo_id: 'mu1' }))
  const pack = screen.getByRole('heading', { level: 2, name: 'Queue' }).closest('section').querySelectorAll('li.m-dl-row')[0]
  fireEvent.click(within(pack).getByRole('button', { name: 'Resume' }))
  await waitFor(() => expect(posts(fn)).toContainEqual({ mode: 'resume', nzo_id: 'pk' }))

  const count = posts(fn).length
  fireEvent.click(within(music).getByRole('button', { name: 'Remove from SABnzbd Queue' }))
  const dialog = await screen.findByRole('dialog')
  expect(within(dialog).getByText('Remove download?')).toBeInTheDocument()
  expect(within(dialog).getByText(`Remove “${MUSIC_RELEASE}” from the SABnzbd queue. This does not remove it from Sonarr or Radarr.`)).toBeInTheDocument()
  expect(posts(fn)).toHaveLength(count)
  fireEvent.click(within(dialog).getByRole('button', { name: 'Remove from SABnzbd Queue' }))
  await waitFor(() => expect(onToast).toHaveBeenCalledWith('Item removed from the SABnzbd queue', 'info'))
  expect(posts(fn).slice(count)).toEqual([{ mode: 'queue', name: 'delete', value: 'mu1' }])
})
test('a failed pause toasts the error (criterion 18)', async () => {
  world({ slots: [slot('a')], overrides: { '/api/sabnzbd/action': () => reply({ error: 'boom' }) } })
  const { onToast } = page()
  fireEvent.click(await screen.findByRole('button', { name: 'Pause' }))
  await waitFor(() => expect(onToast).toHaveBeenCalledWith('Error: boom', 'error'))
})

// ---- History (criterion 19) ----
test('history rows: thumbnail or glyph, title, subtitle, size or Failed, relative time from a fixed clock; Load more as Classic (criterion 19)', async () => {
  fixClock()
  const fn = world({
    history: [
      { nzo_id: 'h1', name: 'Fixture.Show.S01E04.720p.HDTV-GRP', status: 'Completed', bytes: 1073741824, completed: secondsAgo(25 * MIN), category: 'tv' },
      { nzo_id: 'h2', name: 'Fixture.Film.2023.1080p-GRP', status: 'Completed', mb: '2048', completed: secondsAgo(DAYMS + 2 * MIN), category: 'movies' },
      { nzo_id: 'h3', name: 'Fixture.Failed.Thing-GRP', status: 'Failed', bytes: 1048576, completed: secondsAgo(3 * DAYMS), category: '*' },
      { nzo_id: 'h4', name: MUSIC_RELEASE, status: 'Completed', bytes: 524288000, completed: 0, category: 'music' },
      { nzo_id: 'h5', name: 'Fixture.Another.S01E01-GRP', status: 'Extracting', bytes: 1, completed: secondsAgo(MIN / 2), category: 'tv' },
    ], total: 40,
  })
  page()
  const section = (await screen.findByRole('heading', { level: 2, name: 'Recent History' })).closest('section')
  await waitFor(() => expect(within(section).getByRole('link', { name: 'Fixture Show' })).toBeInTheDocument())
  const rows = [...section.querySelectorAll('li.m-dl-row')]
  expect(rows).toHaveLength(5)
  const [show, film, failed, music, post] = rows
  expect(within(show).getByText('S1 E4')).toBeInTheDocument()
  expect(within(show).getByText('1.0 GB')).toBeInTheDocument()
  expect(within(show).getByText('25 min ago')).toBeInTheDocument()
  expect(within(film).getByRole('link', { name: 'Fixture Film' })).toHaveAttribute('href', '#/movies/9')
  expect(within(film).getByText('2023 · Movie')).toBeInTheDocument()
  expect(within(film).getByText('2.0 GB')).toBeInTheDocument()
  expect(within(film).getByText('Yesterday')).toBeInTheDocument()
  expect(within(failed).getByText('Failed')).toHaveClass('m-dl-failed')
  expect(within(failed).getByText('3 days ago')).toBeInTheDocument()
  expect(within(failed).getByRole('img', { name: 'Download' })).toBeInTheDocument()
  expect(within(music).getByText('500 MB')).toBeInTheDocument()
  expect(music.querySelector('.m-dl-row-side').children).toHaveLength(1)
  expect(within(post).getByText('Extracting')).toBeInTheDocument()
  expect(within(post).getByText('Just now')).toBeInTheDocument()
  fireEvent.click(within(section).getByRole('button', { name: 'Load more' }))
  await waitFor(() => expect(fn.calls.some(call => call.url === '/api/sabnzbd/history?limit=30')).toBe(true))
})

// ---- Idle (criterion 20) ----
const calendarEpisode = (id, seriesId, title, hours) => ({ id, seriesId, seasonNumber: 1, episodeNumber: 1, title: 'E', airDateUtc: new Date(NOW + hours * 3600000).toISOString(), hasFile: false, series: { id: seriesId, title, images: [img('poster', 'https://img.invalid/cal.jpg')] } })
test('idle with a matched, completed item: hero with the check, Downloaded time, subtitle and quality plus size (criterion 20)', async () => {
  fixClock()
  world({ history: [
    { nzo_id: 'new-bare', name: 'Other.Show.S01E01.720p-GRP', status: 'Completed', bytes: 1, completed: secondsAgo(1 * MIN), category: 'tv' },
    { nzo_id: 'failed', name: 'Fixture.Show.S02E09.1080p-GRP', status: 'Failed', bytes: 1, completed: secondsAgo(2 * MIN), category: 'tv' },
    { nzo_id: 'lead', name: 'Fixture.Show.S02E05.2160p.WEB-DL.DV.HDR.Atmos.x265-GRP', status: 'Completed', bytes: 1073741824, completed: secondsAgo(25 * MIN), category: 'tv' },
    { nzo_id: 'older', name: 'Fixture.Show.S02E04.1080p-GRP', status: 'Completed', bytes: 1, completed: secondsAgo(2 * DAYMS), category: 'tv' },
  ] })
  const { container } = page({ cfg: only(config, 'sabnzbd', 'sonarr') })
  const title = await screen.findByRole('heading', { level: 2, name: 'Fixture Show' })
  const hero = container.querySelector('.m-dl-hero')
  expect(hero).toHaveClass('is-fanart')
  expect(hero.querySelector('.m-dl-done svg')).not.toBeNull()
  expect(within(hero).getByText('Downloaded 25 min ago')).toBeInTheDocument()
  expect(within(title).getByRole('link')).toHaveAttribute('href', '#/shows/7')
  expect(within(hero).getByText('S2 E5')).toBeInTheDocument()
  expect(within(hero).getByText('4K · Dolby Vision · HDR · Atmos · 1.0 GB')).toBeInTheDocument()
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  expect(screen.getByText('Nothing is downloading. When Sonarr or Radarr grabs an episode or movie, it appears here.')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Pause All|Resume All/ })).toBeNull()
  expect(screen.getByRole('link', { name: 'Search NZBs' })).toBeInTheDocument()
})
test('idle with nothing to show: the plain header and meta text, one h1 (criterion 20)', async () => {
  world({ history: [
    { nzo_id: 'a', name: 'Unknown.Show.S01E01-GRP', status: 'Completed', bytes: 1, completed: secondsAgo(MIN), category: 'tv' },
    { nzo_id: 'b', name: 'Other.Show.S01E01-GRP', status: 'Completed', bytes: 1, completed: secondsAgo(MIN), category: 'tv' },
  ], data: { series: [{ id: 5, title: 'Other Show', images: [] }] } })
  const { container } = page()
  expect(await screen.findByText('Nothing is downloading', { selector: '.m-meta' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { level: 1, name: 'Downloads' })).not.toHaveClass('m-sr')
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  expect(container.querySelector('.m-dl-hero')).toBeNull()
})
test('Coming up: at most three rows with entryLabel names, See all, Nothing scheduled, and omitted without Sonarr or Radarr (criterion 20)', async () => {
  fixClock()
  const episodes = [calendarEpisode(1, 11, 'Show A', 30), calendarEpisode(2, 12, 'Show B', 3), calendarEpisode(3, 13, 'Show C', 50), calendarEpisode(4, 14, 'Show D', 6), calendarEpisode(5, 15, 'Gone', -5)]
  world({ overrides: { '/api/sonarr/calendar': () => reply(episodes) } })
  const cfg = only(config, 'sabnzbd', 'sonarr')
  const first = page({ cfg })
  const heading = await screen.findByRole('heading', { level: 2, name: 'Coming up' })
  const expected = sortEntries(collapse(episodes, NOW)).filter(entry => entry.at >= NOW).slice(0, 3).map(entryLabel)
  const section = heading.closest('section')
  await waitFor(() => expect(within(section).getAllByRole('link').filter(a => a.className.includes('m-dl-row'))).toHaveLength(3))
  expect(within(section).getAllByRole('link').filter(a => a.className.includes('m-dl-row')).map(a => a.getAttribute('aria-label'))).toEqual(expected)
  expect(within(section).getByRole('link', { name: /See all/ })).toHaveAttribute('href', '#/upcoming')
  expect(within(section).getByText('Today · 6:00 PM')).toBeInTheDocument()
  expect(screen.queryByText('Gone')).toBeNull()
  first.unmount()

  world({ overrides: { '/api/sonarr/calendar': () => reply([]) } })
  const second = page({ cfg })
  expect(await screen.findByText('Nothing scheduled in this window')).toBeInTheDocument()
  second.unmount()

  world({})
  page({ cfg: only(config, 'sabnzbd') })
  await screen.findAllByText(/Nothing is downloading/)
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)) })
  expect(screen.queryByRole('heading', { name: 'Coming up' })).toBeNull()
})

// ---- Structure and states (criteria 21, 22) ----
test('structure: one h1, no skipped levels, named controls, text alternatives, empty alt, no link around a button (criterion 21)', async () => {
  richQueue()
  const { container } = page()
  await screen.findByRole('heading', { level: 2, name: 'Fixture Show' })
  const headings = [...container.querySelectorAll('h1, h2, h3')].map(h => Number(h.tagName[1]))
  expect(headings.filter(level => level === 1)).toHaveLength(1)
  expect(headings[0]).toBe(1)
  headings.forEach((level, i) => { if (i) expect(level - headings[i - 1]).toBeLessThanOrEqual(1) })
  for (const el of container.querySelectorAll('button, a[href]')) expect(el, el.outerHTML.slice(0, 80)).toHaveAccessibleName()
  for (const tile of container.querySelectorAll('.m-dl-glyph')) { expect(tile).toHaveAttribute('role', 'img'); expect(tile).toHaveAccessibleName() }
  for (const art of container.querySelectorAll('img')) expect(art.getAttribute('alt')).toBe('')
  expect(container.querySelector('a button, a [role="button"]')).toBeNull()
  for (const svg of container.querySelectorAll('svg')) expect(svg).toHaveAttribute('aria-hidden', 'true')
})
test('loading shows a status until the arr queues answered, and no unmatched flash happens first (criterion 22)', async () => {
  const gate = deferred()
  world({ slots: [slot('ep1', { filename: SHOW_RELEASE })], sonarr: [sonarrRecord('ep1')], overrides: { '/api/sonarr/queue': async () => { await gate.promise; return reply(envelope([sonarrRecord('ep1')])) } } })
  page()
  expect(screen.getByRole('status')).toHaveTextContent('Loading downloads…')
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 60)) })
  expect(screen.getByRole('status')).toHaveTextContent('Loading downloads…')
  expect(screen.queryByText('Fixture Show Name')).toBeNull()
  await act(async () => { gate.resolve() })
  expect(await screen.findByRole('heading', { level: 2, name: 'Fixture Show' })).toBeInTheDocument()
  expect(screen.queryByText('Fixture Show Name')).toBeNull()
})
test('a SABnzbd failure shows the Classic error block with Retry (criterion 22)', async () => {
  let down = true
  const fn = world({ slots: [slot('a')], overrides: { '/api/sabnzbd/queue': () => (down ? reply({ error: 'SAB offline' }, false) : reply(queueOf([slot('a')]))) } })
  page()
  expect(await screen.findByText('Cannot reach SABnzbd')).toBeInTheDocument()
  expect(screen.getByText('SAB offline')).toBeInTheDocument()
  expect(screen.queryByRole('heading', { level: 2 })).toBeNull()
  down = false
  const before = requests(fn, '/api/sabnzbd/queue')
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  await waitFor(() => expect(requests(fn, '/api/sabnzbd/queue')).toBeGreaterThan(before))
  await screen.findByRole('button', { name: 'Pause' })
})
test('an arr queue failure keeps the list, hides the hint and says matches may be missing (criterion 12)', async () => {
  world({ slots: [slot('tv1', { filename: SHOW_RELEASE })], overrides: { '/api/sonarr/queue': () => reply({ error: 'x' }, false) } })
  page()
  await screen.findByRole('heading', { level: 2, name: 'Fixture Show Name' })
  expect(await screen.findByText('Could not reach Sonarr, so matches may be missing.')).toHaveAttribute('role', 'status')
  expect(screen.queryByText('Not in Sonarr')).toBeNull()
})

// ---- Pill (criterion 23) ----
const dashboard = (hash, cfg = config) => { window.location.hash = hash; return render(<Dashboard config={cfg} onConfigSaved={() => {}} />) }
test('pill: shown on wide screens while a slot downloads, with its link, name and ring; the first downloading slot leads (criterion 23)', async () => {
  world({ slots: [slot('p', { status: 'Paused', percentage: '5' }), slot('d', { percentage: '64' }), slot('e', { percentage: '10' })] })
  dashboard('#/shows')
  const pill = await screen.findByRole('link', { name: 'Downloads, 64%, 47.1 MB/s' })
  expect(pill).toHaveAttribute('href', '#/downloads')
  expect(pill.closest('.m-topbar')).not.toBeNull()
  const ring = within(pill).getByRole('progressbar', { name: 'Download progress' })
  expect(ring).toHaveAttribute('aria-valuenow', '64'); expect(ring).toHaveAttribute('aria-valuemin', '0'); expect(ring).toHaveAttribute('aria-valuemax', '100')
  expect(pill).toHaveTextContent('47.1 MB/s')
  expect(pill.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
})
test('pill: hidden when nothing downloads, when the queue is only paused or queued, and without SABnzbd (criterion 23)', async () => {
  for (const slots of [[], [slot('p', { status: 'Paused' })], [slot('q', { status: 'Queued', percentage: '0' })]]) {
    const fn = world({ slots })
    const { unmount } = dashboard('#/shows')
    await screen.findByRole('heading', { level: 1, name: 'TV Shows' })
    await waitFor(() => expect(requests(fn, '/api/sabnzbd/queue')).toBeGreaterThan(0))
    await act(async () => {})
    expect(document.querySelector('.m-live-pill')).toBeNull()
    unmount()
  }
  const fn = world({ slots: [slot('d')] })
  dashboard('#/shows', only(config, 'sonarr', 'radarr', 'nzbhydra'))
  await screen.findByRole('heading', { level: 1, name: 'TV Shows' })
  await act(async () => {})
  expect(document.querySelector('.m-live-pill')).toBeNull()
  expect(requests(fn, '/api/sabnzbd/queue')).toBe(0)
})
test('pill: there is no pill and no queue request on phones away from the download surfaces (criterion 23, 10)', async () => {
  restoreMedia(); restoreMedia = stubMedia({ phone: true })
  const fn = world({ slots: [slot('d')] })
  dashboard('#/upcoming')
  await screen.findByRole('heading', { level: 1, name: 'Upcoming' })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)) })
  expect(document.querySelector('.m-live-pill')).toBeNull()
  expect(requests(fn, '/api/sabnzbd/queue') + requests(fn, '/api/sonarr/queue') + requests(fn, '/api/radarr/queue')).toBe(0)
})

// ---- Show page (criterion 24) ----
const missingEpisodes = [...libraryEpisodes, { id: 204, seasonNumber: 2, episodeNumber: 4, title: 'Also Gone', hasFile: false, airDateUtc: new Date(NOW - 5 * DAYMS).toISOString() }]
const episodeRecord = (downloadId, episodeId, seriesId = 1) => ({ downloadId, seriesId, episodeId, series: { id: seriesId, title: 'Alpha Show' }, episode: { id: episodeId, seasonNumber: 2, episodeNumber: 2, title: 'Gone Missing' } })
test('show page: a queued episode shows its live status instead of both Download buttons, others keep theirs (criterion 24)', async () => {
  world({ slots: [slot('dl', { percentage: '64' })], sonarr: [episodeRecord('dl', 202)], data: { series: librarySeries, episodes: missingEpisodes } })
  dashboard('#/shows/1')
  await screen.findByRole('heading', { level: 1, name: 'Alpha Show' })
  const row = title => screen.getByRole('heading', { level: 3, name: title }).closest('li')
  await waitFor(() => expect(within(row('Gone Missing')).getByText('Downloading')).toBeInTheDocument())
  const live = row('Gone Missing')
  expect(within(live).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '64')
  expect(within(live).getByText('64% · 1 min left')).toBeInTheDocument()
  expect(within(live).queryByRole('button', { name: /Download/ })).toBeNull()
  expect(within(live).queryByRole('button', { name: /Interactive search/ })).toBeNull()
  expect(live.querySelector('.m-ep-meta')).not.toHaveTextContent('Missing')
  const other = row('Also Gone')
  expect(within(other).getByRole('button', { name: /Download/ })).toBeInTheDocument()
  expect(within(other).getByRole('button', { name: /Interactive search/ })).toBeInTheDocument()
  expect(other.querySelector('.m-ep-meta')).toHaveTextContent('Missing')
  expect(within(row('Return')).getByText('Downloaded')).toBeInTheDocument()
  expect(within(row('Return')).queryByRole('progressbar')).toBeNull()
})
test('show page: a paused episode says Paused with its percentage (criterion 24)', async () => {
  world({ slots: [slot('dl', { status: 'Paused', percentage: '12' })], sonarr: [episodeRecord('dl', 202)], data: { series: librarySeries, episodes: missingEpisodes } })
  dashboard('#/shows/1')
  const row = await screen.findByRole('heading', { level: 3, name: 'Gone Missing' })
  await waitFor(() => expect(within(row.closest('li')).getByText('Paused')).toBeInTheDocument())
  expect(within(row.closest('li')).getByText('12%')).toBeInTheDocument()
  expect(within(row.closest('li')).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '12')
})
test('show page: unrelated slots leave every button and cost one Sonarr queue request (criterion 24, 10)', async () => {
  const fn = world({ slots: [slot('other')], sonarr: [episodeRecord('other', 999, 2)], data: { series: librarySeries, episodes: missingEpisodes } })
  dashboard('#/shows/1')
  const row = await screen.findByRole('heading', { level: 3, name: 'Gone Missing' })
  await waitFor(() => expect(requests(fn, '/api/sonarr/queue')).toBe(1))
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 60)) })
  expect(within(row.closest('li')).getByRole('button', { name: /Download/ })).toBeInTheDocument()
  expect(requests(fn, '/api/sonarr/queue')).toBe(1)
  expect(requests(fn, '/api/radarr/queue')).toBe(0)
})

// ---- Movies (criterion 25) ----
const movieSlots = [slot('m2', { cat: 'movies', percentage: '64' }), slot('m3', { cat: 'movies', status: 'Paused', percentage: '12' })]
const movieRecords = [radarrRecord('m2', { id: 12, title: 'Movie Two', year: 2025 }), radarrRecord('m3', { id: 13, title: 'Movie Three', year: 2026 })]
test('movie tiles show Downloading and Paused with a bar over the poster; other movies are unchanged (criterion 25)', async () => {
  world({ slots: movieSlots, radarr: movieRecords, data: { movies: libraryMovies } })
  dashboard('#/movies')
  await screen.findByRole('heading', { level: 1, name: 'Movies' })
  const tile = title => screen.getByRole('link', { name: title }).closest('li')
  await waitFor(() => expect(within(tile('Movie Two')).getByText('Downloading · 64%')).toBeInTheDocument())
  expect(within(tile('Movie Two')).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '64')
  expect(tile('Movie Two').querySelector('.m-poster .m-live-bar')).not.toBeNull()
  expect(within(tile('Movie Three')).getByText('Paused · 12%')).toBeInTheDocument()
  expect(tile('Movie Three').querySelector('.m-live-bar')).toHaveClass('is-attn')
  expect(within(tile('Movie One')).queryByRole('progressbar')).toBeNull()
  expect(within(tile('Movie Four')).getByText('Unmonitored')).toBeInTheDocument()
})
test('small posters and list rows show the same status (criterion 25)', async () => {
  localStorage.setItem('arrview.ui.v1.movies.view', '"small"')
  world({ slots: movieSlots, radarr: movieRecords, data: { movies: libraryMovies } })
  const small = dashboard('#/movies')
  await screen.findByRole('link', { name: 'Movie Two, Downloading · 64%' })
  expect(screen.getByRole('link', { name: 'Movie Three, Paused · 12%' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Movie One' })).toBeInTheDocument()
  small.unmount()
  localStorage.setItem('arrview.ui.v1.movies.view', '"list"')
  dashboard('#/movies')
  await waitFor(() => expect(document.querySelector('.m-row .m-live-text')).not.toBeNull())
  const row = screen.getByText('Movie Two', { selector: '.m-row-title' }).closest('li')
  expect(within(row).getByText('Downloading · 64%')).toBeInTheDocument()
})
test('the movie page shows the status and a bar on the poster (criterion 25)', async () => {
  world({ slots: movieSlots, radarr: movieRecords, data: { movies: libraryMovies } })
  const { container } = dashboard('#/movies/12')
  await screen.findByRole('heading', { level: 1, name: 'Movie Two' })
  await waitFor(() => expect(container.querySelector('.m-statusline')).toHaveTextContent('Downloading · 64%'))
  expect(container.querySelector('.m-movie-poster .m-live-bar')).toHaveAttribute('aria-valuenow', '64')
  expect(container.querySelector('.m-statusline')).not.toHaveClass('m-attn')
})
test('movies: unrelated slots cost one Radarr queue request and no Sonarr request (criterion 25, 10)', async () => {
  const fn = world({ slots: [slot('x', { cat: 'movies' })], radarr: [], data: { movies: libraryMovies } })
  dashboard('#/movies')
  await screen.findByRole('heading', { level: 1, name: 'Movies' })
  await waitFor(() => expect(requests(fn, '/api/radarr/queue')).toBe(1))
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 60)) })
  expect(requests(fn, '/api/radarr/queue')).toBe(1)
  expect(requests(fn, '/api/sonarr/queue')).toBe(0)
})
