const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { startServer } = require('./helpers/server-harness');

// Sonarr and Radarr share one API shape: each answers /api/v3/system/status for its own key, so Sonarr's address and key typed
// into the Radarr row (or the other way round) used to test "Connected" and then fail on every page. Both name themselves in that
// answer (appName), so the Test and the status ping read it. Only a positive mismatch is refused: an app that does not name itself
// (Sonarr 3 sends no appName) or that carries another name on the same API is accepted as before.

const KEY = 'fixture-only-key-1';
const SONARR = { appName: 'Sonarr', instanceName: 'Sonarr', version: '4.0.20.3014' };
const RADARR = { appName: 'Radarr', instanceName: 'Radarr', version: '6.4.4.10685' };
const STATUS = '/api/v3/system/status';
const json = body => ({ status: 200, body: JSON.stringify(body) });

// A small upstream whose answers are written out per path; anything not listed is a plain 404, as the apps answer for a path
// they do not have (Sonarr for /api/v3/movie, Radarr for /api/v3/series).
async function serve(t, routes) {
  const hits = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://upstream.invalid');
    hits.push({ path: url.pathname, key: req.headers['x-api-key'] });
    const r = routes[url.pathname] || { status: 404, type: 'text/plain', body: '' };
    res.writeHead(r.status, { 'Content-Type': r.type || 'application/json' });
    res.end(r.body ?? '');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  return { hits, url: `http://127.0.0.1:${server.address().port}` };
}

test('the other app\'s address and key are not Connected: the Test names the app that answered', async t => {
  const s = await startServer(t, { config: {} });
  const sonarr = await serve(t, { [STATUS]: json(SONARR) });
  const radarr = await serve(t, { [STATUS]: json(RADARR) });

  let r = await s.json('POST', '/api/test/radarr', { url: sonarr.url, apikey: KEY });
  assert.equal(r.status, 503);
  assert.deepEqual(await r.json(), { error: 'That address is Sonarr, not Radarr — check the address and port' });

  r = await s.json('POST', '/api/test/sonarr', { url: radarr.url, apikey: KEY });
  assert.equal(r.status, 503);
  assert.deepEqual(await r.json(), { error: 'That address is Radarr, not Sonarr — check the address and port' });

  // One request each, to the path the Test always used, with the key that was typed.
  assert.deepEqual(sonarr.hits, [{ path: STATUS, key: KEY }]);
  assert.deepEqual(radarr.hits, [{ path: STATUS, key: KEY }]);
});

test('the name is read whatever its case or padding', async t => {
  const s = await startServer(t, { config: {} });
  for (const appName of ['sonarr', 'SONARR', ' Sonarr ']) {
    const up = await serve(t, { [STATUS]: json({ ...SONARR, appName }) });
    const r = await s.json('POST', '/api/test/radarr', { url: up.url, apikey: KEY });
    assert.equal(r.status, 503, appName);
    assert.match((await r.json()).error, /^That address is Sonarr, not Radarr/, appName);
  }
});

test('the right app is Connected with its version', async t => {
  const s = await startServer(t, { config: {} });
  for (const [service, answer] of [['sonarr', SONARR], ['radarr', RADARR]]) {
    const up = await serve(t, { [STATUS]: json(answer) });
    const r = await s.json('POST', `/api/test/${service}`, { url: up.url, apikey: KEY });
    assert.equal(r.status, 200, service);
    assert.deepEqual(await r.json(), { success: true, version: answer.version }, service);
  }
});

test('an app that does not name itself, or that carries another name, is accepted in either row as before', async t => {
  const s = await startServer(t, { config: {} });
  for (const [name, answer] of [
    ['no appName (Sonarr 3)', { version: '3.0.6.1342' }],
    ['an empty appName', { appName: '', version: '3.0.6.1342' }],
    ['an appName that is not text', { appName: 7, version: '3.0.6.1342' }],
    ['another app on the same API', { appName: 'Whisparr', version: '2.0.0.548' }],
  ]) {
    const up = await serve(t, { [STATUS]: json(answer) });
    for (const service of ['sonarr', 'radarr']) {
      const r = await s.json('POST', `/api/test/${service}`, { url: up.url, apikey: KEY });
      assert.equal(r.status, 200, `${service}: ${name}`);
      assert.deepEqual(await r.json(), { success: true, version: answer.version }, `${service}: ${name}`);
    }
  }
});

test('a 200 that is not a status answer is not the app: a web page, a login page, JSON without a version', async t => {
  const s = await startServer(t, { config: {} });
  for (const [name, route] of [
    ['a web page', { status: 200, type: 'text/html', body: '<!doctype html><html><title>NAS</title></html>' }],
    ['an empty object', json({})],
    ['a version that is not text', json({ version: 4 })],
    ['an empty version', json({ version: ' ' })],
    ['an array', json(['version'])],
    ['an error as JSON', json({ error: 'Unauthorized' })],
  ]) {
    const up = await serve(t, { [STATUS]: route });
    for (const [service, label] of [['sonarr', 'Sonarr'], ['radarr', 'Radarr']]) {
      const r = await s.json('POST', `/api/test/${service}`, { url: up.url, apikey: KEY });
      assert.equal(r.status, 503, `${service}: ${name}`);
      assert.deepEqual(await r.json(), { error: `That address answered, but not like ${label} — check the address and port` }, `${service}: ${name}`);
    }
  }
});

test('a rejected key and an address nothing answers on keep their own words', async t => {
  const s = await startServer(t, { config: {} });
  const locked = await serve(t, { [STATUS]: { status: 401, body: '' } });
  let r = await s.json('POST', '/api/test/radarr', { url: locked.url, apikey: KEY });
  assert.equal(r.status, 503);
  assert.deepEqual(await r.json(), { error: 'HTTP 401: Unauthorized' });

  const none = await serve(t, {});
  r = await s.json('POST', '/api/test/sonarr', { url: none.url, apikey: KEY });
  assert.equal(r.status, 503);
  assert.deepEqual(await r.json(), { error: 'HTTP 404: Not Found' });
});

test('the status of a saved app agrees with the Test: the other app is not "Connected"', async t => {
  const sonarr = await serve(t, { [STATUS]: json(SONARR) });
  const radarr = await serve(t, { [STATUS]: json(RADARR) });
  const old = await serve(t, { [STATUS]: json({ version: '3.0.6.1342' }) });
  const ping = async (s, service) => { const r = await fetch(`${s.base}/api/${service}/ping`); return [r.status, await r.json()]; };

  // Sonarr's address and key saved in the Radarr row, and Radarr's in the Sonarr row.
  const swapped = await startServer(t, { config: { radarr: { url: sonarr.url, apikey: KEY }, sonarr: { url: radarr.url, apikey: KEY } } });
  assert.deepEqual(await ping(swapped, 'radarr'), [503, { error: 'Service unavailable' }]);
  assert.deepEqual(await ping(swapped, 'sonarr'), [503, { error: 'Service unavailable' }]);

  const right = await startServer(t, { config: { sonarr: { url: sonarr.url, apikey: KEY }, radarr: { url: radarr.url, apikey: KEY } } });
  assert.deepEqual(await ping(right, 'sonarr'), [200, { status: 'ok' }]);
  assert.deepEqual(await ping(right, 'radarr'), [200, { status: 'ok' }]);

  // An app that does not name itself stays online in either row.
  const unnamed = await startServer(t, { config: { sonarr: { url: old.url, apikey: KEY }, radarr: { url: old.url, apikey: KEY } } });
  assert.deepEqual(await ping(unnamed, 'sonarr'), [200, { status: 'ok' }]);
  assert.deepEqual(await ping(unnamed, 'radarr'), [200, { status: 'ok' }]);
});

test('saving is unchanged: it asks nothing of the apps, so a row can be saved while its app is down', async t => {
  const sonarr = await serve(t, { [STATUS]: json(SONARR) });
  const s = await startServer(t, { config: {} });
  const r = await s.json('POST', '/api/config', { radarr: { url: sonarr.url, apikey: KEY } });
  assert.equal(r.status, 200);
  assert.equal(s.readConfig().radarr.url, sonarr.url);
  assert.deepEqual(sonarr.hits, []);
});

test('the refusals name only the two apps: no address, no key and nothing the other app sent', async t => {
  const s = await startServer(t, { config: {} });
  const up = await serve(t, { [STATUS]: json({ ...SONARR, instanceName: 'secret-instance-name', urlBase: '/secret-base' }) });
  const text = await (await s.json('POST', '/api/test/radarr', { url: up.url, apikey: KEY })).text();
  for (const leak of [KEY, up.url, '127.0.0.1', 'secret-instance-name', 'secret-base', '4.0.20.3014']) assert.ok(!text.includes(leak), leak);
});
