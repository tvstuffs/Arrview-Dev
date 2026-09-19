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
const upstream = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost')
  res.setHeader('Content-Type', 'application/json')
  if (url.searchParams.get('mode') === 'queue') return res.end(JSON.stringify({ queue: { status: 'Idle', slots: [] } }))
  if (url.searchParams.get('mode') === 'history') return res.end(JSON.stringify({ history: { slots: [
    { nzo_id: 'bytes', name: 'Bytes history', bytes: 1073741824, status: 'Completed' },
    { nzo_id: 'mb', name: 'Legacy history', mb: '512', status: 'Completed' },
  ] } }))
  if (url.pathname.endsWith('/series') || url.pathname.endsWith('/movie')) return res.end('[]')
  res.end(JSON.stringify({ version: '4.0', caps: { server: { title: 'fixture' } } }))
})
upstream.listen(0, '127.0.0.1', () => {
  const config = Object.fromEntries(['sabnzbd', 'sonarr', 'radarr', 'nzbhydra'].map(service => [service,
    { url: `http://127.0.0.1:${upstream.address().port}`, apikey: 'fixture-only-key', ...(service === 'sabnzbd' ? { sabPath: '/api' } : {}) }]))
  fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify(config))
  const app = express()
  let workerRevision = 0
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
