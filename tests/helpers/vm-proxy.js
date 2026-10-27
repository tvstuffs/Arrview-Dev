const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const express = require('express');

// Runs server.js in a vm context against a loopback fake upstream for one service.
// `up` controls the fake upstream; `state.config` is the config served to the server.
async function startProxy(t, service) {
  const up = { status: 200, payload: undefined, rawBody: undefined, redirect: false, hits: 0, last: undefined };
  const upstream = http.createServer((req, res) => {
    up.hits += 1;
    up.last = { url: new URL(req.url, 'http://localhost'), key: req.headers['x-api-key'] };
    res.writeHead(up.redirect ? 302 : up.status, { 'Content-Type': 'application/json', ...(up.redirect ? { Location: '/leak' } : {}) });
    res.end(up.rawBody ?? JSON.stringify(up.payload));
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  t.after(() => upstream.close());
  const state = { config: { [service]: { url: `http://127.0.0.1:${upstream.address().port}/${service}/`, apikey: 'fixture-only' } } };
  const app = express();
  let server;
  app.listen = () => { server = http.createServer(app); return server.listen(0, '127.0.0.1'); };
  const factory = () => app;
  Object.assign(factory, express);
  const repo = path.resolve(__dirname, '..', '..');
  vm.runInNewContext(fs.readFileSync(path.join(repo, 'server.js'), 'utf8'), {
    require(name) {
      if (name === 'express') return factory;
      if (name === 'fs') return {
        ...fs,
        existsSync(file) { return file.endsWith('config.json') || fs.existsSync(file); },
        readFileSync(file, ...args) { return file.endsWith('config.json') ? JSON.stringify(state.config) : fs.readFileSync(file, ...args); },
      };
      return require(name);
    },
    __dirname: repo, process: { env: { PORT: '0' } }, console: { log() {} },
    setInterval, clearInterval, setTimeout, clearTimeout,
  });
  await new Promise(resolve => { const wait = () => (!server ? setImmediate(wait) : server.listening ? resolve() : server.on('listening', resolve)); wait(); });
  t.after(() => server.close());
  return { up, state, base: `http://127.0.0.1:${server.address().port}` };
}

module.exports = { startProxy };
