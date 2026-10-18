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

const upstream = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost')
  requests.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams) })
  res.setHeader('Content-Type', 'application/json')
  if (url.searchParams.get('mode') === 'queue') return res.end(JSON.stringify({ queue: { status: 'Downloading', kbpersec: '1024', timeleft: '00:10:00', slots: [{ nzo_id: 'queue1', filename: 'A long fixture download title for mobile layout verification', status: 'Downloading', percentage: '25', mb: '1024', mbleft: '768', cat: 'tv', timeleft: '00:10:00' }] } }))
  if (url.searchParams.get('mode') === 'history') return res.end(JSON.stringify({ history: { slots: [
    { nzo_id: 'bytes', name: 'Bytes history', bytes: 1073741824, status: 'Completed' },
    { nzo_id: 'mb', name: 'Legacy history', mb: '512', status: 'Completed' },
  ] } }))
  // All four fake services share this upstream and path; the server asks Sonarr with includeSeries and Radarr without.
  if (url.pathname.endsWith('/calendar')) return res.end(JSON.stringify(url.searchParams.has('includeSeries') ? sonarrCalendar() : radarrCalendar()))
  if (url.pathname.endsWith('/lookup')) return res.end(JSON.stringify([{ title: 'A long fixture lookup result with descriptive text', tvdbId: 201, tmdbId: 201, year: 2024, overview: 'Fixture overview', seasons: [] }]))
  if (url.pathname.endsWith('/qualityprofile')) return res.end(JSON.stringify([{ id: 1, name: 'HD 1080p' }]))
  if (url.pathname.endsWith('/rootfolder')) return res.end(JSON.stringify([{ path: '/media/library' }]))
  if (url.pathname.endsWith('/release')) return res.end(JSON.stringify([{ guid: 'r1', title: 'Fixture.Show.S01E02.1080p.Long.Release.Name', size: 1073741824, ageHours: 3, indexer: 'Fixture indexer', approved: true, quality: { quality: { name: 'HDTV-1080p' } } }, { guid: 'r2', title: 'Fixture.Show.S01E02.Rejected.Release', size: 2147483648, ageHours: 6, indexer: 'Another indexer', approved: false, rejections: ['Quality is not wanted in this profile'] }]))
  if (url.pathname.endsWith('/episode')) return res.end(JSON.stringify([
    { id: 11, seriesId: 1, seasonNumber: 1, episodeNumber: 1, title: 'Downloaded episode with a long descriptive title', overview: 'Episode description for an accessible information control.', hasFile: true, episodeFileId: 101, airDateUtc: '2020-01-01T00:00:00Z', runtime: 42, images: [{ coverType: 'screenshot', remoteUrl: 'https://localhost:18778/arrview-icon.svg' }] },
    { id: 12, seriesId: 1, seasonNumber: 1, episodeNumber: 2, title: 'Missing episode with a long title', overview: 'Another episode description.', hasFile: false, airDateUtc: '2020-01-02T00:00:00Z', images: [{ coverType: 'screenshot', remoteUrl: 'https://localhost:18778/__fixture/broken.png' }] },
    { id: 13, seriesId: 1, seasonNumber: 1, episodeNumber: 3, title: 'Upcoming episode', hasFile: false, airDateUtc: '2099-01-01T00:00:00Z' },
  ]))
  if (url.pathname.endsWith('/series')) return res.end(JSON.stringify([{ id: 1, title: 'Fixture Show with a long title', titleSlug: 'fixture-show', year: 2024, network: 'Fixture Network', genres: ['Drama', 'Mystery', 'Thriller', 'Comedy'], overview: 'A fixture overview that is long enough to need clamping when it is shown in the hero on any screen size. It keeps going so that three lines are never enough for it, and says nothing real.', monitored: true, images: [{ coverType: 'poster', remoteUrl: 'https://localhost:18778/arrview-icon.svg' }, { coverType: 'fanart', remoteUrl: 'https://localhost:18778/arrview-icon.svg' }], status: 'continuing', seasons: [{ seasonNumber: 1, statistics: { totalEpisodeCount: 3, episodeFileCount: 1 } }] }]))
  if (url.pathname.endsWith('/movie')) return res.end(JSON.stringify([{ id: 2, title: 'Fixture Movie with a long descriptive title', year: 2024, studio: 'Fixture Studio', images: [{ coverType: 'poster', remoteUrl: 'https://localhost:18778/arrview-icon.svg' }, { coverType: 'fanart', remoteUrl: 'https://localhost:18778/arrview-icon.svg' }], monitored: true, isAvailable: true, hasFile: false, overview: 'A movie description to verify wrapping and action controls.' }]))
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
