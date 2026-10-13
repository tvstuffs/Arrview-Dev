// Shared vm harness: runs server.js in a vm context with a temp __dirname and a
// supplied process.env, like tests/w3-parity.test.js, plus a fake upstream.
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const express = require('express');

async function startUpstream() {
  const hits = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    hits.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams),
      key: req.headers['x-api-key'] });
    // SABnzbd answers only on /api, so detection probes /sabnzbd/api first and fails.
    const missing = url.pathname.endsWith('/sabnzbd/api');
    res.writeHead(missing ? 404 : 200, { 'Content-Type': 'application/json' });
    if (missing) return res.end('{}');
    res.end(JSON.stringify({ version: '1.2.3', status: true, caps: {}, history: { slots: [] } }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { hits, port: server.address().port, close: () => server.close() };
}

// options: { env, config (object or string), fsOverrides (fn(realFs) -> fs-like), files }
async function startServer(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arrview-env-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(root, 'dist', 'index.html'), '<html>shell</html>');
  const configFile = path.join(root, 'config.json');
  if (options.config !== undefined) {
    fs.writeFileSync(configFile, typeof options.config === 'string' ? options.config : JSON.stringify(options.config));
  }
  const logs = [];
  const app = express();
  let server;
  app.listen = () => { server = http.createServer(app); return server.listen(0, '127.0.0.1'); };
  const factory = () => app;
  Object.assign(factory, express);
  const fsModule = options.fsOverrides ? options.fsOverrides(fs) : fs;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../server.js'), 'utf8'), {
    require: name => name === 'express' ? factory : name === 'fs' ? fsModule : require(name),
    __dirname: root, process: { env: { PORT: '0', ...(options.env || {}) } },
    console: { log: (...args) => logs.push(args.join(' ')) },
    setInterval, clearInterval, setTimeout, clearTimeout,
  });
  await new Promise(resolve => server.on('listening', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const json = (method, url, body, headers = { 'Content-Type': 'application/json' }) =>
    fetch(base + url, { method, headers, body: typeof body === 'string' ? body : JSON.stringify(body) });
  return {
    root, base, logs, configFile, json,
    readConfigText: () => fs.readFileSync(configFile, 'utf8'),
    readConfig: () => JSON.parse(fs.readFileSync(configFile, 'utf8')),
    getConfig: async () => (await fetch(base + '/api/config')).json(),
    tempFiles: () => fs.readdirSync(root).filter(f => f !== 'config.json' && f !== 'dist'),
  };
}

module.exports = { startUpstream, startServer };
