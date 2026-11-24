const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { startServer } = require('./helpers/server-harness');
const { standIn } = require('./helpers/stand-in');

// One request must never end the process. On 4bc9d46 a query value that is an object made Number() throw inside an async route,
// and the rejection was unhandled. Now every route handler's throw or rejection goes to one final JSON 500, the history route checks
// `limit` as a string first, and a guarded unhandledRejection hook logs and keeps running. Cases from the 2026-11-24 scan (L0, L1)
// plus the safety net (NET-*). In this harness a crash shows up as an unhandled rejection in the runner, not as an exit.

const KEY = 'fixture-only-key-1';
const LIMIT_ERROR = { error: 'limit must be an integer from 1 to 1000' };
const SAB_VERSION = JSON.stringify({ version: '4.0.0', status: true, history: { slots: [] } });

async function sabServer(t, options = {}) {
  const up = await standIn(t, { '/sabnzbd/api': { status: 404, body: '{}' }, '/api': { body: SAB_VERSION } });
  const s = await startServer(t, { config: { sabnzbd: { url: up.url, apikey: KEY } }, ...options });
  return { s, up };
}
const serverLines = logs => logs.filter(line => line.startsWith('[server]'));

test('L0: limit=abc is refused with today\'s message and nothing is sent upstream', async t => {
  const { s, up } = await sabServer(t);
  const r = await fetch(s.base + '/api/sabnzbd/history?limit=abc');
  assert.equal(r.status, 400);
  assert.deepEqual(await r.json(), LIMIT_ERROR);
  assert.equal(up.hits.length, 0);
});

test('L1: limit[toString]=1 is a 400, and the next request is answered', async t => {
  const { s, up } = await sabServer(t);
  const r = await fetch(s.base + '/api/sabnzbd/history?limit[toString]=1');
  assert.equal(r.status, 400);
  assert.deepEqual(await r.json(), LIMIT_ERROR);
  assert.equal((await fetch(s.base + '/api/health')).status, 200);
  assert.equal(up.hits.length, 0);
});

test('L1b: every other shape of limit is a 400 with nothing sent, and limit=10 reaches SABnzbd as 10', async t => {
  const { s, up } = await sabServer(t);
  for (const query of ['limit[a]=1', 'limit=1&limit=2', 'limit[]=5', 'limit=abc', 'limit=0', 'limit=1001', 'limit=1.5', 'limit=-1',
    'limit=', 'limit=%2010', 'limit=1e2', 'limit=00001']) {
    const r = await fetch(`${s.base}/api/sabnzbd/history?${query}`);
    assert.equal(r.status, 400, query);
    assert.deepEqual(await r.json(), LIMIT_ERROR, query);
  }
  assert.equal(up.hits.length, 0);
  const ok = await fetch(s.base + '/api/sabnzbd/history?limit=10');
  assert.equal(ok.status, 200);
  const history = up.hits.filter(h => h.query.mode === 'history');
  assert.equal(history.length, 1);
  assert.equal(history[0].query.limit, '10');
  // Absent: 15, as before.
  await fetch(s.base + '/api/sabnzbd/history');
  assert.equal(up.hits.filter(h => h.query.mode === 'history')[1].query.limit, '15');
});

test('NET-sync: a handler that throws gets a plain JSON 500 and one log line, never a stack', async t => {
  const index = path.join('dist', 'index.html');
  const s = await startServer(t, {
    fsOverrides: real => ({
      ...real,
      existsSync: p => {
        if (String(p).endsWith(index)) throw new TypeError('fixture failure /secret/path');
        return real.existsSync(p);
      },
    }),
  });
  const before = serverLines(s.logs).length;
  const r = await fetch(s.base + '/some/page');
  assert.equal(r.status, 500);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  const text = await r.text();
  assert.equal(text, '{"error":"Internal error"}');
  assert.ok(!/at |fixture failure|secret/.test(text));
  const lines = serverLines(s.logs).slice(before);
  assert.deepEqual(lines, ['[server] request failed: GET * (TypeError)']);
  assert.equal((await fetch(s.base + '/api/health')).status, 200);
});

test('NET-async: a rejected async handler gets a plain JSON 500, and the server keeps answering', async t => {
  const s = await startServer(t);
  s.app.get('/api/test-reject', async () => { throw new Error('boom /secret'); });
  // Test-only use of Express 4 internals: the new route was appended after the SPA fallback and the final error handler, so it is
  // moved in front of the fallback. Layers are found by route path and by arity, never by a fixed index.
  const stack = s.app._router.stack;
  const at = stack.findIndex(layer => layer.route?.path === '/api/test-reject');
  const [moved] = stack.splice(at, 1);
  const fallback = stack.findIndex(layer => layer.route?.path === '*');
  assert.ok(fallback >= 0);
  stack.splice(fallback, 0, moved);
  const finalHandler = stack.findIndex((layer, i) => i > fallback && !layer.route && layer.handle.length === 4);
  assert.ok(finalHandler > stack.indexOf(moved), 'the final error handler sits after the moved route');

  const r = await fetch(s.base + '/api/test-reject');
  assert.equal(r.status, 500);
  assert.equal(await r.text(), '{"error":"Internal error"}');
  assert.ok(s.logs.includes('[server] request failed: GET /api/test-reject (Error)'));
  assert.ok(!s.logs.some(line => line.includes('boom')));
  assert.equal((await fetch(s.base + '/api/health')).status, 200);
});

test('NET-hook: one unhandledRejection handler is registered when process.on exists, and it only logs', async t => {
  const registered = [];
  const s = await startServer(t, { processExtras: { on: (event, fn) => registered.push([event, fn]) } });
  const handlers = registered.filter(([event]) => event === 'unhandledRejection');
  assert.equal(handlers.length, 1);
  const before = serverLines(s.logs).length;
  assert.doesNotThrow(() => handlers[0][1](new TypeError('x /secret'), Promise.resolve()));
  const lines = serverLines(s.logs).slice(before);
  assert.deepEqual(lines, ['[server] unhandled rejection (TypeError)']);
  assert.equal((await fetch(s.base + '/api/health')).status, 200);
});

test('NET-settings: app.get with one argument is still the settings getter', async t => {
  const s = await startServer(t);
  assert.equal(typeof s.app.get('env'), 'string');
});

test('NET-sweep: an upstream error body that cannot be turned into text no longer ends the process', async t => {
  // The catch of DELETE /api/sonarr/episodefile/:id runs String() on the upstream's error body; a JSON object whose toString is
  // not a function makes that throw inside the catch block. The safety net now answers it.
  const up = await standIn(t, { 'DELETE /api/v3/episodefile/7': { status: 500, body: '{"toString":1}' } });
  const s = await startServer(t, { config: { sonarr: { url: up.url, apikey: KEY } } });
  const r = await s.json('DELETE', '/api/sonarr/episodefile/7');
  assert.equal(r.status, 500);
  assert.deepEqual(await r.json(), { error: 'Internal error' });
  assert.equal((await fetch(s.base + '/api/health')).status, 200);
});
