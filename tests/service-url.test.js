const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { startServer } = require('./helpers/server-harness');
const { cases } = require('./fixtures/service-urls.json');

// The address rule of Settings -> Services: an http:// address is taken to be a local one and must name its port; an https://
// address is taken to be a public host name that leads to the app by name, so it needs none. ArrView adds no default port to what
// is typed there. The browser's copy of the rule is tested against the same table in tests/web/service-url.test.js.

const LABELS = { sabnzbd: 'SABnzbd', nzbhydra: 'NZBHydra', sonarr: 'Sonarr', radarr: 'Radarr' };
const KEY = 'fixture-only-key-1';

// A stand-in for axios that records every call and answers none, so a test can say "no request was made".
const noNetwork = calls => new Proxy({}, { get: (_, method) => async url => { calls.push(`${String(method)} ${url}`); throw new Error('no request expected'); } });

test('saving applies the address rule to every service, from one shared table', async t => {
  const s = await startServer(t, { config: {} });
  for (const c of cases) {
    const label = `${c.service} ${c.input}`;
    const r = await s.json('POST', '/api/config', { [c.service]: { url: c.input, apikey: KEY } });
    if (c.stored) {
      assert.equal(r.status, 200, label);
      assert.equal(s.readConfig()[c.service].url, c.stored, label);
    } else if (c.problem) {
      assert.equal(r.status, 400, label);
      assert.equal((await r.json()).error, `${LABELS[c.service]}: ${c.problem}`, label);
    } else {
      assert.equal(r.status, 400, label);
      assert.match((await r.json()).error, /must be an http\(s\) URL without credentials, query or fragment/, label);
    }
    // back to nothing saved, so that the next case is a new address
    assert.equal((await s.json('POST', '/api/config', {})).status, 200, label);
  }
});

test('a refused address is not saved, and nothing else in the file changes', async t => {
  const config = { radarr: { url: 'http://192.0.2.10:7878', apikey: 'kept-radarr-key' } };
  const s = await startServer(t, { config });
  const before = s.readConfigText();
  const r = await s.json('POST', '/api/config', { ...(await s.getConfig()), sabnzbd: { url: 'http://192.0.2.10', apikey: KEY } });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /^SABnzbd: Add the port, for example http:\/\/192\.0\.2\.10:8080\./);
  assert.equal(s.readConfigText(), before);
});

test('the Test button follows the same rule and makes no request for an address that is refused', async t => {
  const calls = [];
  const s = await startServer(t, { config: {}, modules: { axios: noNetwork(calls) } });
  for (const c of cases.filter(c => c.problem)) {
    const r = await s.json('POST', `/api/test/${c.service}`, { url: c.input, apikey: KEY });
    assert.equal(r.status, 400, c.input);
    assert.equal((await r.json()).error, c.problem, c.input);
  }
  assert.deepEqual(calls, []);
  // An address that follows the rule does reach the request stage (here refused by the stand-in).
  const ok = await s.json('POST', '/api/test/sonarr', { url: 'http://192.0.2.10:8989', apikey: KEY });
  assert.equal(ok.status, 503);
  assert.equal((await ok.json()).error, 'no request expected');
  assert.equal(calls.length, 1);
  assert.match(calls[0], /^get http:\/\/192\.0\.2\.10:8989\/api\/v3\/system\/status/);
});

test('an https address without a port is tested at that address, with no port added', async t => {
  const calls = [];
  const s = await startServer(t, { config: {}, modules: { axios: noNetwork(calls) } });
  for (const [service, url, path] of [['sabnzbd', 'https://sab.example.invalid', '/sabnzbd/api'], ['radarr', 'https://radarr.example.invalid/radarr', '/api/v3/system/status']]) {
    const r = await s.json('POST', `/api/test/${service}`, { url, apikey: KEY });
    assert.equal(r.status, 503, service);
    assert.ok(calls.some(c => c.startsWith(`get ${url}${path}`)), `${service}: ${calls.join(' | ')}`);
  }
  assert.ok(calls.every(c => !/:\d+\//.test(c.replace('https://', ''))), calls.join(' | '));
});

test('an address that is already saved keeps saving and testing as it is; only a new or changed one must follow the rule', async t => {
  const calls = [];
  // saved before the rule existed: http, no port
  const config = { sonarr: { url: 'http://nas.example.invalid', apikey: KEY } };
  const s = await startServer(t, { config, modules: { axios: noNetwork(calls) } });
  const body = await s.getConfig();
  assert.equal((await s.json('POST', '/api/config', body)).status, 200);
  assert.equal((await s.json('POST', '/api/config', { sonarr: { ...body.sonarr, url: 'HTTP://nas.example.invalid/' } })).status, 200);
  assert.equal(s.readConfig().sonarr.url, 'http://nas.example.invalid');
  const tested = await s.json('POST', '/api/test/sonarr', { url: 'http://nas.example.invalid', apikey: body.sonarr.apikey });
  assert.equal(tested.status, 503);
  assert.equal((await tested.json()).error, 'no request expected');
  const changed = await s.json('POST', '/api/config', { sonarr: { url: 'http://nas2.example.invalid', apikey: KEY } });
  assert.equal(changed.status, 400);
  assert.match((await changed.json()).error, /^Sonarr: Add the port/);
  assert.equal((await s.json('POST', '/api/test/sonarr', { url: 'http://nas2.example.invalid', apikey: KEY })).status, 400);
  assert.equal(s.readConfig().sonarr.url, 'http://nas.example.invalid');
});

test('Docker variables are not part of the rule: ARRVIEW_HOST still adds the default ports and an explicit address is used as written', async t => {
  const env = {
    ARRVIEW_HOST: 'nas.example.invalid', ARRVIEW_SABNZBD_API_KEY: 'env-sab-key', ARRVIEW_RADARR_API_KEY: 'env-radarr-key',
    ARRVIEW_SONARR_URL: 'http://sonarr.example.invalid', ARRVIEW_SONARR_API_KEY: 'env-sonarr-key',
  };
  const s = await startServer(t, { env });
  const config = await s.getConfig();
  assert.equal(config.sabnzbd.url, 'http://nas.example.invalid:8080');
  assert.equal(config.radarr.url, 'http://nas.example.invalid:7878');
  assert.equal(config.sonarr.url, 'http://sonarr.example.invalid');
  assert.deepEqual(config.envManaged, { sabnzbd: true, nzbhydra: false, sonarr: true, radarr: true });
});

// A small upstream whose answers are written out per path; anything not listed is a plain 404.
async function serve(t, routes) {
  const hits = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://upstream.invalid');
    hits.push(url.pathname);
    const r = routes[url.pathname] || { status: 404, type: 'text/plain', body: '404: Not Found' };
    res.writeHead(r.status, { 'Content-Type': r.type || 'application/json', ...(r.location ? { Location: r.location } : {}) });
    res.end(r.body ?? '');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  return { port: server.address().port, hits, url: `http://127.0.0.1:${server.address().port}` };
}

// What a NAS with a web server on port 80 does with SABnzbd's address: nginx redirects /sabnzbd/api to its own page, which answers 200.
const NAS_PAGE = {
  '/sabnzbd/api': { status: 302, type: 'text/html', location: '/ui/?mode=version', body: '<h1>302 Found</h1>' },
  '/ui/': { status: 200, type: 'text/html', body: '<!doctype html><html><title>NAS</title></html>' },
};
const NOT_SAB = /^That address answered, but not like SABnzbd/;

test('a web page that answers where SABnzbd should is not SABnzbd: the Test says so, and so does the Downloads route', async t => {
  const nas = await serve(t, NAS_PAGE);
  const s = await startServer(t, { config: {} });
  const r = await s.json('POST', '/api/test/sabnzbd', { url: nas.url, apikey: KEY });
  assert.equal(r.status, 503);
  assert.match((await r.json()).error, NOT_SAB);
  // The same address saved: the queue is not the page.
  assert.equal((await s.json('POST', '/api/config', { sabnzbd: { url: nas.url, apikey: KEY } })).status, 200);
  const queue = await fetch(`${s.base}/api/sabnzbd/queue`);
  assert.equal(queue.status, 503);
  assert.deepEqual(await queue.json(), { error: 'Cannot reach SABnzbd' });
  assert.equal(s.readConfig().sabnzbd.sabPath, undefined);
});

test('JSON, a login page or any other 200 without a version string is not SABnzbd', async t => {
  const s = await startServer(t, { config: {} });
  for (const [name, route] of [
    ['JSON with status true and no version', { status: 200, body: '{"status": true}' }],
    ['an empty object', { status: 200, body: '{}' }],
    ['a version that is not a string', { status: 200, body: '{"version": 5}' }],
    ['an empty version', { status: 200, body: '{"version": ""}' }],
    ['an array', { status: 200, body: '["version"]' }],
    ['a login page', { status: 200, type: 'text/html', body: '<html><form>login</form></html>' }],
    ['another app\'s error as JSON', { status: 200, body: '{"status": false, "error": "API Key Incorrect"}' }],
  ]) {
    const up = await serve(t, { '/api': route });
    const r = await s.json('POST', '/api/test/sabnzbd', { url: up.url, apikey: KEY });
    assert.equal(r.status, 503, name);
    assert.match((await r.json()).error, NOT_SAB, name);
  }
});

test('nothing answering is still "could not reach", and a real SABnzbd is found at /api or at /sabnzbd/api with its version', async t => {
  const s = await startServer(t, { config: {} });
  const none = await serve(t, {});
  let r = await s.json('POST', '/api/test/sabnzbd', { url: none.url, apikey: KEY });
  assert.equal(r.status, 503);
  assert.equal((await r.json()).error, 'Could not reach SABnzbd — check URL and API key');

  const root = await serve(t, { '/api': { status: 200, body: '{"version": "5.1.3"}' } });
  r = await s.json('POST', '/api/test/sabnzbd', { url: root.url, apikey: KEY });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { success: true, version: '5.1.3', sabPath: '/api' });
  assert.deepEqual(root.hits, ['/sabnzbd/api', '/api'], 'one probe per path, and no second request for the version');

  const sub = await serve(t, { '/sabnzbd/api': { status: 200, body: '{"version": "4.2.1"}' } });
  r = await s.json('POST', '/api/test/sabnzbd', { url: sub.url, apikey: KEY });
  assert.deepEqual(await r.json(), { success: true, version: '4.2.1', sabPath: '/sabnzbd/api' });
});

test('the Test and the Downloads route agree: what the Test accepts, the queue reads', async t => {
  const sab = await serve(t, { '/api': { status: 200, body: '{"version": "5.1.3", "queue": {"slots": []}}' } });
  const s = await startServer(t, { config: {} });
  assert.equal((await s.json('POST', '/api/test/sabnzbd', { url: sab.url, apikey: KEY })).status, 200);
  assert.equal((await s.json('POST', '/api/config', { sabnzbd: { url: sab.url, apikey: KEY } })).status, 200);
  const queue = await fetch(`${s.base}/api/sabnzbd/queue`);
  assert.equal(queue.status, 200);
  assert.deepEqual((await queue.json()).queue, { slots: [] });
  assert.equal(s.readConfig().sabnzbd.sabPath, '/api');
});
