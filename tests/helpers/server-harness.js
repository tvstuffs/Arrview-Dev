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

// options: { env, config (object or string), fsOverrides (fn(realFs) -> fs-like), files,
//   modules (module name -> replacement for the server's require; an Error is thrown instead),
//   runListenCallback (true runs the app.listen callback, where the startup banner and Bonjour live),
//   wrapCrypto (fn(realCrypto) -> crypto-like, what the server's require('crypto') returns),
//   clock (fn -> ms; the server's Date.now() returns it),
//   root (an existing directory to reuse, so a second startServer is a restart: dist is kept and not deleted),
//   startTimeoutMs (default 15000; startServer rejects instead of hanging when the server never listens),
//   handle (an object filled at once with { logs, listenCalls }, so a test can look while start-up is still running) }
async function startServer(t, options = {}) {
  const reuse = Boolean(options.root);
  const root = options.root || fs.mkdtempSync(path.join(os.tmpdir(), 'arrview-env-'));
  if (!reuse) {
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(root, 'dist', 'index.html'), '<html>shell</html>');
  }
  const configFile = path.join(root, 'config.json');
  const authFile = path.join(root, 'auth.json');
  if (options.config !== undefined) {
    fs.writeFileSync(configFile, typeof options.config === 'string' ? options.config : JSON.stringify(options.config));
  }
  const logs = [];
  const app = express();
  let server;
  let listenCalls = 0;
  let markListening;
  const listening = new Promise(resolve => { markListening = resolve; });
  if (options.handle) Object.assign(options.handle, { logs, listenCalls: () => listenCalls });
  app.listen = (_port, onListening) => {
    listenCalls += 1;
    server = http.createServer(app);
    server.on('listening', markListening);
    return server.listen(0, '127.0.0.1', options.runListenCallback ? onListening : undefined);
  };
  const factory = () => app;
  Object.assign(factory, express);
  const fsModule = options.fsOverrides ? options.fsOverrides(fs) : fs;
  const replaced = options.modules || {};
  const sandbox = {
    require: name => {
      if (name in replaced) {
        if (replaced[name] instanceof Error) throw replaced[name];
        return replaced[name];
      }
      if (name === 'crypto' && options.wrapCrypto) return options.wrapCrypto(require('crypto'));
      return name === 'express' ? factory : name === 'fs' ? fsModule : require(name);
    },
    __dirname: root, process: { env: { PORT: '0', ...(options.env || {}) } },
    console: { log: (...args) => logs.push(args.join(' ')) },
    setInterval, clearInterval, setTimeout, clearTimeout,
  };
  if (options.clock) {
    sandbox.Date = class ClockDate extends Date { static now() { return options.clock(); } };
  }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../server.js'), 'utf8'), sandbox);
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`server did not start listening within ${options.startTimeoutMs || 15000} ms`)),
      options.startTimeoutMs || 15000);
  });
  try { await Promise.race([listening, timeout]); } finally { clearTimeout(timer); }
  const close = () => new Promise(resolve => { server.closeAllConnections(); server.close(() => resolve()); });
  t.after(close);
  const base = `http://127.0.0.1:${server.address().port}`;
  const json = (method, url, body, headers = { 'Content-Type': 'application/json' }) =>
    fetch(base + url, { method, headers, body: typeof body === 'string' ? body : JSON.stringify(body) });
  return {
    root, base, logs, configFile, json, app, authFile, close,
    listenCalls: () => listenCalls,
    readConfigText: () => fs.readFileSync(configFile, 'utf8'),
    readConfig: () => JSON.parse(fs.readFileSync(configFile, 'utf8')),
    readAuthText: () => fs.readFileSync(authFile, 'utf8'),
    readAuth: () => JSON.parse(fs.readFileSync(authFile, 'utf8')),
    getConfig: async () => (await fetch(base + '/api/config')).json(),
    tempFiles: () => fs.readdirSync(root).filter(f => f !== 'config.json' && f !== 'auth.json' && f !== 'dist'),
  };
}

module.exports = { startUpstream, startServer };
