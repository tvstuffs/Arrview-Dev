// Isolated loopback-only fixture: production Express routes + build, fake upstream.
const http = require('node:http')
const https = require('node:https')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const vm = require('node:vm')
const { execFileSync } = require('node:child_process')
const express = require('express')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arrview-pwa-'))
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(root, 'key.pem'),
  '-out', path.join(root, 'cert.pem'), '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], { stdio: 'ignore' })
let requests = []

// Calendar data is generated relative to now so the server's own window filter keeps it. Artwork uses the fixture origin.
const ART = 'https://localhost:18778/arrview-icon.svg'
const BROKEN = 'https://localhost:18778/__fixture/broken.png'
const pad = n => String(n).padStart(2, '0')
const localAt = (days, hour) => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(hour, 0, 0, 0); return d.toISOString() }
const releaseDay = days => { const d = new Date(); d.setDate(d.getDate() + days); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T00:00:00Z` }
const artFor = (cover, remoteUrl = ART) => ({ coverType: cover, remoteUrl })
function sonarrCalendar() {
  const series = (id, title) => ({ id, title, images: [artFor('poster'), artFor('fanart')] })
  const episode = (id, show, season, number, airDateUtc, extra = {}) =>
    ({ id, seriesId: show.id, seasonNumber: season, episodeNumber: number, title: `Fixture episode ${number}`, airDateUtc, hasFile: false, series: show, ...extra })
  const drop = series(2, 'Season Drop Fixture Show'), gap = series(3, 'Gap Fixture Show'), cross = series(4, 'Cross Season Fixture Show'), broken = series(5, 'Broken Still Fixture Show')
  return [
    { id: 12, seriesId: 1, seasonNumber: 1, episodeNumber: 2, title: 'Calendar fixture episode', airDateUtc: new Date().toISOString(), hasFile: false, series: { id: 1, title: 'Fixture Show with a long title' } },
    ...Array.from({ length: 8 }, (_, i) => episode(100 + i, drop, 3, i + 1, localAt(1, 21), i === 0 ? { images: [artFor('screenshot')] } : {})),
    ...[1, 2, 4].map((n, i) => episode(200 + i, gap, 1, n, localAt(2, 20))),
    episode(300, cross, 1, 10, localAt(3, 19)), episode(301, cross, 2, 1, localAt(3, 19)),
    episode(400, broken, 1, 1, localAt(3, 21), { images: [artFor('screenshot', BROKEN)] }),
  ]
}
function radarrCalendar() {
  const movie = (id, title, extra = {}) => ({ id, title, year: 2024, monitored: true, hasFile: false, isAvailable: true, status: 'released', images: [artFor('poster'), artFor('fanart')], ...extra })
  return [
    movie(2, 'Fixture Movie with a long descriptive title', { digitalRelease: releaseDay(2) }),
    movie(31, 'Physical Fixture Movie', { physicalRelease: releaseDay(4), physicalReleaseNote: 'Steelbook edition' }),
    movie(32, 'Split Release Fixture Movie', { digitalRelease: releaseDay(5), physicalRelease: releaseDay(9) }),
    movie(33, 'Cinema Only Fixture Movie', { inCinemas: releaseDay(3), digitalRelease: releaseDay(120) }),
    movie(34, 'Downloaded Fixture Movie', { digitalRelease: releaseDay(-1), hasFile: true }),
  ]
}

// ---- Downloads scenarios (POST /__fixture/downloads { scenario }, POST /__fixture/clock { now }) ----
// legacy: the original responses, byte for byte. rich: every kind of download. empty / empty-noart: nothing queued. paused: one paused slot.
const SCENARIOS = ['legacy', 'rich', 'empty', 'empty-noart', 'paused']
let scenario = 'legacy'
let fixtureNow = null
const MINUTE = 60000, DAY = 86400000
const LEGACY_QUEUE = { queue: { status: 'Downloading', kbpersec: '1024', timeleft: '00:10:00', slots: [{ nzo_id: 'queue1', filename: 'A long fixture download title for mobile layout verification', status: 'Downloading', percentage: '25', mb: '1024', mbleft: '768', cat: 'tv', timeleft: '00:10:00' }] } }
const LEGACY_HISTORY = { history: { slots: [
  { nzo_id: 'bytes', name: 'Bytes history', bytes: 1073741824, status: 'Completed' },
  { nzo_id: 'mb', name: 'Legacy history', mb: '512', status: 'Completed' },
] } }
const SHOW = { id: 1, title: 'Fixture Show with a long title', year: 2024, images: [artFor('poster'), artFor('fanart')] }
const SECOND_SHOW = { id: 6, title: 'Second Fixture Show', year: 2023, images: [artFor('poster')] }
const MOVIE = { id: 2, title: 'Fixture Movie with a long descriptive title', year: 2024 }
const sabSlot = (id, filename, cat, status, pct, mb, extra = {}) =>
  ({ nzo_id: id, filename, cat, status, percentage: String(pct), mb: String(mb), mbleft: String(Math.round(mb * (100 - pct) / 100)), timeleft: '0:01:10', ...extra })
const EP_RELEASE = 'Fixture.Show.with.a.long.title.S01E02.2160p.WEB-DL.DV.HDR.Atmos.x265-GRP'
const MOVIE_RELEASE = 'Fixture.Movie.with.a.long.descriptive.title.2024.1080p.BluRay.x264-GRP'
const LONG_SOFTWARE = 'Fixture.Editor.3.2.1.x64.Setup.With.A.Very.Long.Release.Name.That.Must.Wrap.Instead.Of.Scrolling.Sideways.On.A.Narrow.Phone.Screen.Because.It.Is.Long-GRP'
function sabSlots() {
  if (scenario === 'rich') return [
    sabSlot('ep1', EP_RELEASE, 'tv', 'Downloading', 64, 9216),
    sabSlot('mv1', MOVIE_RELEASE, 'movies', 'Paused', 12, 4096),
    sabSlot('mu1', 'Fixture.Artist-Fixture.Album-FLAC-24bit-GRP', 'music', 'Downloading', 30, 512),
    sabSlot('sw1', LONG_SOFTWARE, 'software', 'Queued', 0, 300),
    sabSlot('tv2', 'Unlisted.Fixture.Show.S01E01.1080p.WEB-DL-GRP', 'tv', 'Downloading', 10, 1500),
    sabSlot('SABnzbd_nzo_CaseFix', 'Fixture.Case.Show.S01E01.720p.HDTV-GRP', 'tv', 'Downloading', 5, 700),
  ]
  if (scenario === 'paused') return [sabSlot('pz1', EP_RELEASE, 'tv', 'Paused', 40, 2048)]
  return []
}
function sabQueue() {
  const slots = sabSlots()
  const status = scenario === 'paused' ? 'Paused' : slots.length ? 'Downloading' : 'Idle'
  return { queue: { status, kbpersec: status === 'Downloading' ? '48230' : '0', timeleft: slots.length && status === 'Downloading' ? '0:20:00' : '0:00:00', noofslots: slots.length, slots } }
}
function sabHistory(limit) {
  const now = fixtureNow ?? Date.now()
  const at = ms => Math.floor((now - ms) / 1000)
  const done = (id, name, completed, extra = {}) => ({ nzo_id: id, name, bytes: 1073741824, status: 'Completed', completed: at(completed), category: 'tv', ...extra })
  const unmatched = done('h4', 'Fixture.Unmatched.Thing.S01E01.720p.HDTV-GRP', 5 * DAY)
  const slots = scenario === 'rich' ? [
    done('h1', 'Fixture.Show.with.a.long.title.S01E01.1080p.HDTV-GRP', 25 * MINUTE),
    done('h2', MOVIE_RELEASE, DAY, { category: 'movies', bytes: 2147483648 }),
    done('h3', 'Fixture.Failed.Download-GRP', 3 * DAY, { status: 'Failed', category: '*' }),
    unmatched,
  ] : scenario === 'empty' ? [
    done('h1', 'Fixture.Show.with.a.long.title.S01E01.1080p.HDTV-GRP', 25 * MINUTE),
    unmatched,
  ] : scenario === 'empty-noart' ? [unmatched, done('h5', 'Fixture.Another.Unmatched.Item-GRP', 2 * DAY, { category: 'software' })] : []
  return { history: { noofslots: slots.length, slots: slots.slice(0, limit) } }
}
// A second show with no queue record, served in rich only (the negative polling test).
const secondSeries = () => ({ ...SECOND_SHOW, titleSlug: 'second-fixture-show', network: 'Fixture Network', genres: [], overview: 'A second fixture show.', monitored: true, status: 'continuing',
  seasons: [{ seasonNumber: 1, statistics: { totalEpisodeCount: 3, episodeFileCount: 1 } }] })
// Raw Sonarr / Radarr queue records (the server maps them): rich matches ep1 and mv1 exactly, and one record differs from its slot by case only.
function arrQueue(params) {
  const sonarr = params.has('includeSeries')
  const record = (downloadId, extra) => ({ id: 1, title: 'Fixture queue record', status: 'downloading', size: 1000, sizeleft: 500, timeleft: '00:01:10', trackedDownloadStatus: 'ok', trackedDownloadState: 'downloading', downloadId, ...extra })
  let records = []
  if (scenario === 'rich' || scenario === 'paused') {
    const id = scenario === 'paused' ? 'pz1' : 'ep1'
    if (sonarr) {
      records = [record(id, { quality: { quality: { name: 'WEBDL-2160p' } }, seriesId: 1, episodeId: 12, series: SHOW,
        episode: { id: 12, seasonNumber: 1, episodeNumber: 2, title: 'Missing episode with a long title', airDateUtc: '2020-01-02T00:00:00Z' } })]
      if (scenario === 'rich') records.push(record('SABnzbd_nzo_casefix', { seriesId: 1, episodeId: 11, series: SHOW, episode: { id: 11, seasonNumber: 1, episodeNumber: 1, title: 'Case fixture', airDateUtc: '2020-01-01T00:00:00Z' } }))
    } else if (scenario === 'rich') {
      records = [record('mv1', { quality: { quality: { name: 'Bluray-1080p' } }, movieId: 2, movie: { ...MOVIE, images: [artFor('poster')] } })]
    }
  }
  return { page: 1, pageSize: 100, totalRecords: records.length, records }
}

const upstream = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost')
  requests.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams) })
  res.setHeader('Content-Type', 'application/json')
  if (url.searchParams.get('mode') === 'queue') return res.end(JSON.stringify(scenario === 'legacy' ? LEGACY_QUEUE : sabQueue()))
  if (url.searchParams.get('mode') === 'history') return res.end(JSON.stringify(scenario === 'legacy' ? LEGACY_HISTORY : sabHistory(Number(url.searchParams.get('limit')) || 15)))
  if (url.pathname.endsWith('/queue')) return res.end(JSON.stringify(arrQueue(url.searchParams)))
  // All four fake services share this upstream and path; the server asks Sonarr with includeSeries and Radarr without.
  if (url.pathname.endsWith('/calendar')) return res.end(JSON.stringify(url.searchParams.has('includeSeries') ? sonarrCalendar() : radarrCalendar()))
  if (url.pathname.endsWith('/lookup')) return res.end(JSON.stringify([
    { title: 'A long fixture lookup result with descriptive text', tvdbId: 201, tmdbId: 201, year: 2024, overview: 'Fixture overview', seasons: [], network: 'Fixture Network', studio: 'Fixture Studio', genres: ['Drama', 'Mystery', 'Thriller', 'Comedy'], images: [{ coverType: 'poster', remoteUrl: ART }] },
    { title: 'Poster-less fixture result', tvdbId: 202, tmdbId: 202, year: 2022, overview: 'A result without artwork.', seasons: [] },
    { title: 'Fixture result already in the library', tvdbId: 203, tmdbId: 203, id: 77, year: 2021, overview: 'Already added.', seasons: [], images: [{ coverType: 'poster', remoteUrl: ART }] },
  ]))
  // Profile 2 is the one the fixture library uses, so the default differs from the first profile listed.
  // Sonarr and Radarr send every single quality with an empty `items` array, so the fixture does too.
  const allowedLeaf = (id, name, resolution, allowed = true) => ({ quality: { id, name, resolution }, items: [], allowed })
  if (url.pathname.endsWith('/qualityprofile')) return res.end(JSON.stringify([
    { id: 1, name: 'Fixture HD 1080p', items: [allowedLeaf(7, 'Bluray-1080p', 1080)] },
    { id: 2, name: 'Fixture Standard', items: [allowedLeaf(4, 'HDTV-720p', 720), allowedLeaf(9, 'HDTV-1080p', 1080)] },
    { id: 3, name: 'Fixture Any', items: [allowedLeaf(1, 'SDTV', 480), { name: 'WEB 2160p', allowed: true, items: [allowedLeaf(18, 'WEBDL-2160p', 2160), allowedLeaf(19, 'WEBRip-2160p', 2160)] }, allowedLeaf(0, 'Unknown', 0)] },
  ]))
  if (url.pathname.endsWith('/rootfolder')) return res.end(JSON.stringify([{ path: '/media/tv', freeSpace: 850 * 1024 ** 3 }, { path: '/media/tv2', freeSpace: 2.1 * 1024 ** 4 }]))
  if (url.pathname.endsWith('/release')) return res.end(JSON.stringify([{ guid: 'r1', title: 'Fixture.Show.S01E02.1080p.Long.Release.Name', size: 1073741824, ageHours: 3, indexer: 'Fixture indexer', approved: true, quality: { quality: { name: 'HDTV-1080p' } } }, { guid: 'r2', title: 'Fixture.Show.S01E02.Rejected.Release', size: 2147483648, ageHours: 6, indexer: 'Another indexer', approved: false, rejections: ['Quality is not wanted in this profile'] }]))
  if (url.pathname.endsWith('/episode')) return res.end(JSON.stringify([
    { id: 11, seriesId: 1, seasonNumber: 1, episodeNumber: 1, title: 'Downloaded episode with a long descriptive title', overview: 'Episode description for an accessible information control.', hasFile: true, episodeFileId: 101, airDateUtc: '2020-01-01T00:00:00Z', runtime: 42, images: [{ coverType: 'screenshot', remoteUrl: 'https://localhost:18778/arrview-icon.svg' }] },
    { id: 12, seriesId: 1, seasonNumber: 1, episodeNumber: 2, title: 'Missing episode with a long title', overview: 'Another episode description.', hasFile: false, airDateUtc: '2020-01-02T00:00:00Z', images: [{ coverType: 'screenshot', remoteUrl: 'https://localhost:18778/__fixture/broken.png' }] },
    { id: 13, seriesId: 1, seasonNumber: 1, episodeNumber: 3, title: 'Upcoming episode', hasFile: false, airDateUtc: '2099-01-01T00:00:00Z' },
  ]))
  if (url.pathname.endsWith('/series')) return res.end(JSON.stringify([{ id: 1, title: 'Fixture Show with a long title', titleSlug: 'fixture-show', year: 2024, qualityProfileId: 2, rootFolderPath: '/media/tv2', path: '/media/tv2/Fixture Show', network: 'Fixture Network', genres: ['Drama', 'Mystery', 'Thriller', 'Comedy'], overview: 'A fixture overview that is long enough to need clamping when it is shown in the hero on any screen size. It keeps going so that three lines are never enough for it, and says nothing real.', monitored: true, images: [{ coverType: 'poster', remoteUrl: 'https://localhost:18778/arrview-icon.svg' }, { coverType: 'fanart', remoteUrl: 'https://localhost:18778/arrview-icon.svg' }], status: 'continuing', seasons: [{ seasonNumber: 1, statistics: { totalEpisodeCount: 3, episodeFileCount: 1 } }] }, ...(scenario === 'rich' ? [secondSeries()] : [])]))
  if (url.pathname.endsWith('/movie')) return res.end(JSON.stringify([{ id: 2, title: 'Fixture Movie with a long descriptive title', year: 2024, qualityProfileId: 2, path: '/media/tv2/Fixture Movie (2024)', studio: 'Fixture Studio', images: [{ coverType: 'poster', remoteUrl: 'https://localhost:18778/arrview-icon.svg' }, { coverType: 'fanart', remoteUrl: 'https://localhost:18778/arrview-icon.svg' }], monitored: true, isAvailable: true, hasFile: false, overview: 'A movie description to verify wrapping and action controls.' }]))
  if (url.searchParams.get('t') === 'search') return res.end(JSON.stringify({ channel: { item: [{ title: 'A lengthy fixture NZB result title', guid: 'nzb1', link: 'https://example.invalid/fixture.nzb', size: 1073741824 }] } }))
  if (url.pathname.includes('/command')) return res.end(JSON.stringify({ id: 99, status: 'completed', result: 'successful' }))
  res.end(JSON.stringify({ version: '4.0', caps: { server: { title: 'fixture' } } }))
})
upstream.listen(0, '127.0.0.1', () => {
  const config = Object.fromEntries(['sabnzbd', 'sonarr', 'radarr', 'nzbhydra'].map(service => [service,
    { url: `http://127.0.0.1:${upstream.address().port}`, apikey: 'fixture-only-key', ...(service === 'sabnzbd' ? { sabPath: '/api' } : {}) }]))
  fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify(config))
  const app = express()
  let workerRevision = 0
  app.get('/__fixture/broken.png', (req, res) => res.sendStatus(404))
  app.get('/__fixture/requests', (req, res) => res.json(requests))
  app.post('/__fixture/reset-requests', (req, res) => { requests = []; res.sendStatus(204) })
  // Which fake download data the upstream serves, and the instant its history `completed` values count back from (null = the real clock).
  app.post('/__fixture/downloads', express.json(), (req, res) => {
    if (!SCENARIOS.includes(req.body?.scenario)) return res.status(400).json({ error: 'unknown scenario' })
    scenario = req.body.scenario; res.sendStatus(204)
  })
  app.post('/__fixture/clock', express.json(), (req, res) => {
    const now = req.body?.now
    if (now !== null && !Number.isFinite(now)) return res.status(400).json({ error: 'now must be a number or null' })
    fixtureNow = now; res.sendStatus(204)
  })
  app.post('/__fixture/update-worker', (req, res) => { workerRevision += 1; res.sendStatus(204) })
  app.get('/sw.js', (req, res) => {
    res.type('application/javascript').set('Cache-Control', 'no-cache').send(
      fs.readFileSync(path.resolve(__dirname, '../../dist/sw.js'), 'utf8') + `\n// fixture worker revision ${workerRevision}`)
  })
  const server = https.createServer({ key: fs.readFileSync(path.join(root, 'key.pem')), cert: fs.readFileSync(path.join(root, 'cert.pem')) }, app)
  const plain = http.createServer(app)
  app.listen = () => { plain.listen(18779, '127.0.0.1'); return server.listen(18778, '127.0.0.1') }
  const factory = () => app
  Object.assign(factory, express)
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../server.js'), 'utf8'), {
    require: name => name === 'express' ? factory : require(name),
    __dirname: path.resolve(__dirname, '../..'), process: { env: { CONFIG_DIR: root, PORT: '18778' } },
    console, setInterval, clearInterval, setTimeout, clearTimeout,
  })
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
    server.closeAllConnections(); plain.closeAllConnections(); upstream.closeAllConnections()
    server.close(); plain.close(); upstream.close()
    fs.rmSync(root, { recursive: true, force: true }); process.exit(0)
  })
})
