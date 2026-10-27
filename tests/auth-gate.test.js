const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { startServer, startUpstream } = require('./helpers/server-harness');
const { PASSWORD, AJAX, JSON_HEADERS, DAY, newToken, digestOf, newRoot, seedAuth, setCookies, cookieHeader, startSeeded } = require('./helpers/auth-helpers');
const { routeTable } = require('./helpers/route-table');

const GATE_401 = { error: 'Authentication required', auth: true };
const PUBLIC = ['GET /api/health', 'GET /api/arrview/identify', 'GET /api/auth/status', 'POST /api/auth/login',
  'POST /api/auth/logout', 'POST /api/auth/token', 'POST /api/webhooks/sonarr', 'POST /api/webhooks/radarr'];
const nowSec = () => Math.floor(Date.now() / 1000);

async function probe(base, entry, headers = {}, { body = '{}' } = {}) {
  const controller = new AbortController();
  const hasBody = entry.method !== 'GET' && entry.method !== 'HEAD';
  const response = await fetch(base + entry.path, { method: entry.method, headers: hasBody ? { 'Content-Type': 'application/json', ...headers } : headers,
    body: hasBody ? body : undefined, signal: controller.signal });
  const text = /event-stream/.test(response.headers.get('content-type') || '') ? '' : await response.text();
  controller.abort();
  return { response, text };
}

test('route table: the gate precedes everything and every route answers 401 without credentials', async (t) => {
  const s = await startSeeded(t);
  const table = routeTable(s.app);
  const routes = table.filter(e => e.kind === 'route');
  assert.ok(routes.length >= 50, `only ${routes.length} routes found`);
  for (const p of PUBLIC) assert.ok(routes.some(r => `${r.method} ${r.path}` === p), `missing public route ${p}`);
  for (const p of ['GET /api/webhooks/last', 'GET /api/events', 'GET *']) assert.ok(routes.some(r => `${r.method} ${r.template === '*' ? '*' : r.path}` === p), `missing ${p}`);

  const gates = table.filter(e => e.kind === 'middleware' && e.handle === 'authGate');
  assert.equal(gates.length, 1);
  const gateAt = gates[0].topIndex;
  for (const e of table) {
    if (e === gates[0]) continue;
    if (e.topIndex < gateAt) assert.ok(e.kind === 'middleware' && ['query', 'expressInit'].includes(e.name), `${e.name || e.path} precedes the gate`);
    else assert.ok(e.topIndex > gateAt, 'second layer at the gate position');
  }
  const jsonAt = table.find(e => e.handle === 'jsonParser').topIndex;
  assert.ok(gateAt < jsonAt);
  for (const e of table.filter(e => e.kind === 'route')) assert.ok(e.topIndex > gateAt, `${e.method} ${e.path} precedes the gate`);

  const targets = [];
  for (const r of routes) {
    if (r.template === '*') { targets.push({ ...r, path: '/api/__unknown__' }, { ...r, path: '/some/page' }); } else targets.push(r);
  }
  for (const e of targets) {
    const { response, text } = await probe(s.base, e);
    const label = `${e.method} ${e.path}`;
    if (PUBLIC.includes(label) || e.path === '/some/page') {
      assert.notEqual(response.status, 401, label);
      continue;
    }
    assert.equal(response.status, 401, label);
    assert.deepEqual(JSON.parse(text), GATE_401, label);
    assert.equal(response.headers.get('cache-control'), 'no-store', label);
  }
  for (const p of ['/api/__unknown__', '/api/auth/__unknown__', '/api/sonarr/__unknown__']) {
    assert.equal((await fetch(s.base + p)).status, 401, p);
  }
  assert.equal((await fetch(s.base + '/api/config', { method: 'PATCH', headers: JSON_HEADERS, body: '{}' })).status, 401);

  // Signed in: no route is stopped by the gate (the two that would rotate the credentials are left to the route tests).
  const cookie = s.seeded.cookie;
  const skip = new Set(['POST /api/auth/logout', 'POST /api/auth/logout-all', 'POST /api/auth/keys/remove-all']);
  const isGate = (r, text) => (r.status === 401 && text.includes('"auth":true')) || text.includes('Missing X-Requested-With');
  for (const [name, headers] of [['cookie', { Cookie: cookie, 'X-Requested-With': 'ArrView' }], ['key', { 'X-Api-Key': s.seeded.accessKey }]]) {
    for (const e of targets) {
      if (skip.has(`${e.method} ${e.path}`)) continue;
      const { response, text } = await probe(s.base, e, headers);
      assert.ok(!isGate(response, text), `${name}: ${e.method} ${e.path} was stopped by the gate`);
    }
  }
});

test('key headers: X-Api-Key wins, Bearer is case-insensitive, other schemes are ignored', async (t) => {
  const s = await startSeeded(t);
  const good = s.seeded.accessKey;
  const cookie = s.seeded.cookie;
  const status = async headers => (await fetch(s.base + '/api/config', { headers })).status;
  assert.equal(await status({ 'X-Api-Key': good, Authorization: 'Bearer wrong' }), 200);
  assert.equal(await status({ 'X-Api-Key': 'wrong', Authorization: `Bearer ${good}` }), 401);
  assert.equal(await status({ Authorization: `Bearer ${good}` }), 200);
  assert.equal(await status({ Authorization: `bEaReR ${good}` }), 200);
  assert.equal(await status({ Authorization: 'Basic dXNlcjpwYXNz', 'X-Api-Key': good }), 200);
  assert.equal(await status({ Authorization: 'Basic dXNlcjpwYXNz' }), 401);
  assert.equal(await status({ Authorization: 'Basic dXNlcjpwYXNz', Cookie: cookie }), 200);
  assert.equal(await status({ 'X-Api-Key': '', Cookie: cookie }), 401);
  assert.equal(await status({ 'X-Api-Key': 'wrong', Cookie: cookie }), 401);
  assert.equal(await status({ 'X-Api-Key': `${good}, ${good}` }), 401);
  assert.equal(await status({ 'X-Api-Key': good.slice(0, 10) }), 401);
});

test('case, slash and encoded variants', async (t) => {
  const s = await startSeeded(t);
  for (const p of ['/API/config', '/Api/Config/', '/api/config/', '/api/CONFIG', '/API/WEBHOOKS/LAST', '/api/webhooks/last/', '/api/%63onfig']) {
    const r = await fetch(s.base + p);
    assert.equal(r.status, 401, p);
  }
  assert.equal((await fetch(s.base + '/api/config', { method: 'HEAD' })).status, 401);
  assert.equal((await fetch(s.base + '/api/webhooks/sonarr')).status, 401);
  assert.equal((await fetch(s.base + '/API/Health/')).status, 200);
  assert.equal((await fetch(s.base + '/api/ARRVIEW/identify')).status, 200);
  assert.equal((await fetch(s.base + '/Api/Webhooks/Sonarr/', { method: 'POST', headers: JSON_HEADERS, body: '{}' })).status, 200);
  const slashes = await fetch(s.base + '//api/config');
  assert.ok(!(await slashes.text()).includes('envManaged'));
  assert.equal((await fetch(s.base + '/assets/x.js')).status, 404);
  assert.equal((await fetch(s.base + '/some/page')).status, 200);
});

test('webhooks: receivers are open, the last-event read is not, and a signed-in read sees them', async (t) => {
  const s = await startSeeded(t);
  assert.equal((await fetch(s.base + '/api/webhooks/last')).status, 401);
  for (const svc of ['sonarr', 'radarr']) {
    const r = await fetch(`${s.base}/api/webhooks/${svc}`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ eventType: 'Grab' }) });
    assert.equal(r.status, 200);
  }
  const last = await (await fetch(s.base + '/api/webhooks/last', { headers: { 'X-Api-Key': s.seeded.accessKey } })).json();
  assert.equal(last.sonarr.event.eventType, 'Grab');
  assert.equal(last.radarr.event.eventType, 'Grab');
});

test('X-Requested-With rule', async (t) => {
  const s = await startSeeded(t);
  const cookie = s.seeded.cookie;
  const key = s.seeded.accessKey;
  const send = (path, headers, method = 'POST', body = '{}') => fetch(s.base + path, { method, headers: { 'Content-Type': 'application/json', ...headers }, body });
  for (const method of ['POST', 'PUT', 'DELETE']) {
    const path = method === 'DELETE' ? '/api/sonarr/series/1' : '/api/config';
    const denied = await send(path, { Cookie: cookie }, method);
    assert.equal(denied.status, 403, method);
    assert.deepEqual(await denied.json(), { error: 'Missing X-Requested-With header' });
    assert.notEqual((await send(path, { Cookie: cookie, 'X-Requested-With': 'ArrView' }, method)).status, 403, method);
    assert.notEqual((await send(path, { Cookie: cookie, 'X-Requested-With': 'other' }, method)).status, 200);
  }
  assert.equal((await fetch(s.base + '/api/config', { headers: { Cookie: cookie } })).status, 200);
  assert.notEqual((await send('/api/config', { 'X-Api-Key': key })).status, 403);
  assert.equal((await send('/api/webhooks/sonarr', { Cookie: cookie })).status, 200);
  assert.equal((await send('/api/auth/logout', { Cookie: cookie })).status, 403);
  assert.equal((await send('/api/auth/logout', { Cookie: cookie, 'X-Requested-With': 'ArrView' })).status, 200);
  assert.notEqual((await send('/api/config', { 'X-Api-Key': key, Cookie: cookie })).status, 403);
  assert.equal((await send('/api/config', { 'X-Api-Key': 'wrong', Cookie: cookie, 'X-Requested-With': 'ArrView' })).status, 401);
});

test('events: anonymous 401, signed in streams, credential changes end the stream', async (t) => {
  const s = await startSeeded(t, { seedOptions: {} });
  assert.equal((await fetch(s.base + '/api/events')).status, 401);
  const cookie = s.seeded.cookie;
  const open = async () => {
    const r = await fetch(s.base + '/api/events', { headers: { Cookie: cookie } });
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /text\/event-stream/);
    const reader = r.body.getReader();
    await reader.read();
    return reader;
  };
  const ended = async reader => {
    try { for (;;) { const { done } = await reader.read(); if (done) return true; } } catch (_) { return true; }
  };
  const reader = await open();
  const logoutAll = await fetch(s.base + '/api/auth/logout-all', { method: 'POST', headers: { ...AJAX, Cookie: cookie } });
  assert.equal(logoutAll.status, 200);
  assert.equal(await ended(reader), true);
});

test('sliding expiry (at most once a day, stored), expiry and tampering', async (t) => {
  let now = 1_800_000_000_000;
  const root = newRoot(t);
  // Sessions seeded relative to the real clock; the server clock is moved so they sit at the ages under test.
  const real = Math.floor(Date.now() / 1000);
  const sec = () => Math.floor(now / 1000);
  now = real * 1000;
  const seeded = seedAuth(root, PASSWORD, { sessions: [28 * DAY, 29.5 * DAY, -5, 10 * DAY, 2 * DAY, 2 * DAY] });
  const s = await startServer(t, { root, clock: () => now });
  const get = cookie => fetch(s.base + '/api/config', { headers: { Cookie: cookie } });
  const [aged, fresh, expired, good, pubSession, failSession] = seeded.cookies;
  const stored = token => s.readAuth().sessions.find(x => x.digest === digestOf(token));
  const failBefore = stored(seeded.tokens[5]).expires;

  const old = await get(aged);
  assert.equal(old.status, 200);
  const reissued = setCookies(old);
  assert.equal(reissued.length, 1);
  assert.equal(reissued[0].value, seeded.tokens[0], 'the same token goes out again');
  assert.equal(reissued[0].attrs['max-age'], String(30 * DAY));
  await new Promise(r => setTimeout(r, 100));
  assert.equal(stored(seeded.tokens[0]).expires, sec() + 30 * DAY);
  // A second use the same day writes nothing and sends no cookie.
  const again = await get(aged);
  assert.equal(setCookies(again).length, 0);

  const freshRes = await get(fresh);
  assert.equal(freshRes.status, 200);
  assert.equal(setCookies(freshRes).length, 0);
  assert.equal((await get(expired)).status, 401);
  assert.equal((await get(good.slice(0, -4))).status, 401);
  assert.equal((await get(good.slice(0, -2) + (good.endsWith('AA') ? 'BB' : 'AA'))).status, 401);
  assert.equal((await get(`arrview_session=${newToken()}`)).status, 401);
  assert.equal((await get(`arrview_session=${'a'.repeat(300)}`)).status, 401);
  assert.equal((await get(`arrview_session=${newToken()}; ${good}`)).status, 200);
  // Public routes and failures never extend a session.
  const pub = await fetch(s.base + '/api/health', { headers: { Cookie: pubSession } });
  assert.equal(setCookies(pub).length, 0);
  const failed = await fetch(s.base + '/api/sonarr/series/1', { method: 'DELETE', headers: { Cookie: failSession, 'X-Requested-With': 'ArrView' } });
  assert.ok(failed.status >= 400);
  assert.equal(setCookies(failed).length, 0);
  assert.equal(stored(seeded.tokens[5]).expires, failBefore);
  // A session that runs out of time stops working on the next request.
  now += 31 * DAY * 1000;
  assert.equal((await get(good)).status, 401);
});

test('login off: everything answers as before and nothing is created', async (t) => {
  const upstream = await startUpstream();
  t.after(upstream.close);
  const url = `http://127.0.0.1:${upstream.port}`;
  const cfg = Object.fromEntries(['sonarr', 'radarr', 'sabnzbd', 'nzbhydra'].map(k => [k, { url, apikey: 'fixture-only-key' }]));
  for (const variant of ['no file', 'auth off']) {
    const root = newRoot(t);
    if (variant === 'auth off') seedAuth(root);
    const before = variant === 'auth off' ? fs.readFileSync(root + '/auth.json', 'utf8') : null;
    const s = await startServer(t, { root, config: cfg, env: variant === 'auth off' ? { ARRVIEW_AUTH: 'off' } : {} });
    const responses = [
      await fetch(s.base + '/api/health'),
      await fetch(s.base + '/api/config'),
      await s.json('POST', '/api/config', cfg),
      await fetch(s.base + '/api/sonarr/series/1', { method: 'DELETE' }),
      await fetch(s.base + '/api/webhooks/last'),
      await s.json('POST', '/api/webhooks/sonarr', { eventType: 'Test' }),
      await fetch(s.base + '/api/auth/status'),
    ];
    assert.deepEqual(responses.slice(0, 2).map(r => r.status), [200, 200]);
    assert.equal(responses[2].status, 200);
    assert.notEqual(responses[3].status, 401);
    for (const r of responses) assert.equal(r.headers.getSetCookie().length, 0, variant);
    const events = new AbortController();
    const ev = await fetch(s.base + '/api/events', { signal: events.signal });
    assert.equal(ev.status, 200);
    events.abort();
    const logout = await s.json('POST', '/api/auth/logout', {});
    assert.equal(logout.status, 200);
    assert.equal(logout.headers.getSetCookie().length, 0);
    assert.ok(!('auth' in (await (await fetch(s.base + '/api/config')).json())));
    if (variant === 'no file') assert.equal(fs.existsSync(s.authFile), false);
    else assert.equal(fs.readFileSync(s.authFile, 'utf8'), before);
  }
});
