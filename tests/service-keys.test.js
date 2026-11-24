const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { startServer } = require('./helpers/server-harness');

// The Test button and the status of SABnzbd and NZBHydra prove the API key, as Sonarr's and Radarr's do. The stand-ins answer as a
// real SABnzbd 5.1.3 and a real NZBHydra 2 9.3.3 did when asked with the right key, a wrong one and none:
//   SABnzbd: mode=version answers {"version": "5.1.3"} for any key or none; server_stats answers 403 "API Key Incorrect" for a
//            wrong key, 403 "API Key Required" for none, and 200 {"total": 0, ..., "servers": {}} for the right one.
//   NZBHydra: /api?t=caps&o=json answers HTTP 200 with {"code": "100", "description": "Wrong api key"} for a wrong key or none, and
//            the caps for the right one, its version in server["@attributes"].appversion.

const SAB_KEY = 'fixture-only-sab-key';
const HYDRA_KEY = 'fixture-only-hydra-key';
const WRONG = 'garbage-key-1';

async function listen(t, handler) {
  const hits = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://upstream.invalid');
    hits.push({ path: url.pathname, query: Object.fromEntries(url.searchParams) });
    handler(url, res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  return { hits, url: `http://127.0.0.1:${server.address().port}` };
}

const sendJson = (res, body, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
const sendText = (res, status, text) => { res.writeHead(status, { 'Content-Type': 'text/plain' }); res.end(text); };

function realSab(t) {
  return listen(t, (url, res) => {
    if (url.pathname !== '/api') return sendText(res, 404, '404: Not Found');
    const mode = url.searchParams.get('mode');
    const key = url.searchParams.get('apikey');
    if (mode === 'version') return sendJson(res, { version: '5.1.3' });
    if (!key) return sendText(res, 403, 'API Key Required');
    if (key !== SAB_KEY) return sendText(res, 403, 'API Key Incorrect');
    if (mode === 'server_stats') return sendJson(res, { total: 0, month: 0, week: 0, day: 0, servers: {} });
    if (mode === 'queue') return sendJson(res, { queue: { status: 'Idle', slots: [] } });
    return sendJson(res, { status: false, error: 'not implemented' });
  });
}

const HYDRA_CAPS = {
  server: { '@attributes': { appversion: '9.3.3', version: '9.3.3', title: 'NZBHydra 2' } },
  limits: { '@attributes': { max: '100', default: '100' } },
  registration: { '@attributes': { available: 'no', open: 'no' } },
  searching: { search: { '@attributes': { available: 'yes' } } },
  categories: { category: [{ '@attributes': { id: '5000', name: 'TV' } }] },
};

function realHydra(t, caps = HYDRA_CAPS) {
  return listen(t, (url, res) => {
    if (url.pathname !== '/api') return sendText(res, 404, 'Not found');
    if (url.searchParams.get('apikey') !== HYDRA_KEY) return sendJson(res, { code: '100', description: 'Wrong api key' });
    return sendJson(res, caps);
  });
}

const SAB_REFUSED = 'SABnzbd refused this API key — use the API key from Config → General in SABnzbd';
const HYDRA_REFUSED = 'NZBHydra refused this API key — use the API key from Config → Main in NZBHydra';

test('SABnzbd: the Test refuses a key SABnzbd refuses, though SABnzbd answers its version for any key', async t => {
  const sab = await realSab(t);
  const s = await startServer(t, { config: {} });
  let r = await s.json('POST', '/api/test/sabnzbd', { url: sab.url, apikey: WRONG });
  assert.equal(r.status, 503);
  assert.deepEqual(await r.json(), { error: SAB_REFUSED });
  assert.ok(sab.hits.some(h => h.query.mode === 'server_stats' && h.query.apikey === WRONG), 'the key is proven with a call that needs it');
  r = await s.json('POST', '/api/test/sabnzbd', { url: sab.url, apikey: SAB_KEY });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { success: true, version: '5.1.3', sabPath: '/api' });
});

test('SABnzbd: a saved wrong key makes the status offline; the right key makes it ok', async t => {
  const sab = await realSab(t);
  const wrong = await startServer(t, { config: { sabnzbd: { url: sab.url, apikey: WRONG } } });
  let r = await fetch(`${wrong.base}/api/sabnzbd/ping`);
  assert.equal(r.status, 503);
  assert.deepEqual(await r.json(), { error: 'Service unavailable' });
  const right = await startServer(t, { config: { sabnzbd: { url: sab.url, apikey: SAB_KEY } } });
  r = await fetch(`${right.base}/api/sabnzbd/ping`);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { status: 'ok' });
});

test('NZBHydra: the Test refuses a key NZBHydra refuses (it says so with HTTP 200), and the right key reports its version', async t => {
  const hydra = await realHydra(t);
  const s = await startServer(t, { config: {} });
  let r = await s.json('POST', '/api/test/nzbhydra', { url: hydra.url, apikey: WRONG });
  assert.equal(r.status, 503);
  assert.deepEqual(await r.json(), { error: HYDRA_REFUSED });
  r = await s.json('POST', '/api/test/nzbhydra', { url: hydra.url, apikey: HYDRA_KEY });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { success: true, version: '9.3.3' });
});

test('NZBHydra: caps without a version still pass, without one; an answer that is not caps is not NZBHydra', async t => {
  const plain = await realHydra(t, { ...HYDRA_CAPS, server: { title: 'NZBHydra 2' } });
  const s = await startServer(t, { config: {} });
  let r = await s.json('POST', '/api/test/nzbhydra', { url: plain.url, apikey: HYDRA_KEY });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { success: true });
  const other = await listen(t, (url, res) => sendJson(res, { status: true }));
  r = await s.json('POST', '/api/test/nzbhydra', { url: other.url, apikey: HYDRA_KEY });
  assert.equal(r.status, 503);
  assert.deepEqual(await r.json(), { error: 'That address answered, but not like NZBHydra — check the address and port' });
});
