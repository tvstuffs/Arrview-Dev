const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { startServer } = require('./helpers/server-harness');

const FIXTURE_KEY = 'fixture-only-hydra-key';
const UNAVAILABLE = { error: 'Service unavailable' };

// Stub NZBHydra whose next reply is set per test; records every request.
async function startHydraStub(t) {
  const stub = {
    reply: { status: 200, type: 'application/json', body: '{}' },
    hits: [],
  };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    stub.hits.push({ path: url.pathname, query: Object.fromEntries(url.searchParams) });
    const { status, type, body, location } = stub.reply;
    res.writeHead(status, { 'Content-Type': type, ...(location ? { Location: location } : {}) });
    res.end(body);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  stub.port = server.address().port;
  stub.url = `http://127.0.0.1:${stub.port}`;
  return stub;
}

async function setup(t) {
  const stub = await startHydraStub(t);
  const app = await startServer(t, { config: { nzbhydra: { url: stub.url, apikey: FIXTURE_KEY } } });
  const ping = () => fetch(`${app.base}/api/nzbhydra/ping`);
  return { stub, ping };
}

const jsonReply = body => ({ status: 200, type: 'application/json', body: JSON.stringify(body) });

test('NZBHydra2 caps shape without a caps key is accepted', async t => {
  const { stub, ping } = await setup(t);
  stub.reply = jsonReply({
    server: { title: 'NZBHydra 2' },
    limits: {},
    registration: {},
    searching: { available: true },
    categories: [{ name: 'tv' }],
  });
  const res = await ping();
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: 'ok' });
  assert.equal(stub.hits.length, 1);
  assert.equal(stub.hits[0].path, '/api');
  assert.equal(stub.hits[0].query.t, 'caps');
  assert.equal(stub.hits[0].query.o, 'json');
  assert.equal(stub.hits[0].query.apikey, FIXTURE_KEY);
});

test('caps-keyed shape is accepted', async t => {
  const { stub, ping } = await setup(t);
  stub.reply = jsonReply({ caps: { server: { title: 'Hydra' } } });
  const res = await ping();
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: 'ok' });
});

test('error bodies are rejected, including an error next to caps', async t => {
  const { stub, ping } = await setup(t);
  for (const body of [{ error: { code: 100, description: 'x' } }, { caps: {}, error: 'x' }]) {
    stub.reply = jsonReply(body);
    const res = await ping();
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), UNAVAILABLE);
  }
});

test('an HTML login page at HTTP 200 is rejected', async t => {
  const { stub, ping } = await setup(t);
  stub.reply = { status: 200, type: 'text/html', body: '<html><body>Please log in</body></html>' };
  const res = await ping();
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), UNAVAILABLE);
});

test('a redirect is rejected and not followed', async t => {
  const { stub, ping } = await setup(t);
  stub.reply = { status: 302, type: 'text/plain', body: '', location: '/login-target' };
  const res = await ping();
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), UNAVAILABLE);
  assert.equal(stub.hits.some(h => h.path === '/login-target'), false);
  assert.equal(stub.hits.length, 1);
});

test('503 bodies and headers never leak the upstream URL, host:port or key', async t => {
  const { stub, ping } = await setup(t);
  const secrets = [stub.url, `127.0.0.1:${stub.port}`, String(stub.port), FIXTURE_KEY];
  const cases = [
    jsonReply({ error: { code: 100, description: 'x' } }),
    { status: 302, type: 'text/plain', body: '', location: '/login-target' },
  ];
  for (const reply of cases) {
    stub.reply = reply;
    const res = await ping();
    assert.equal(res.status, 503);
    const text = await res.text();
    assert.deepEqual(JSON.parse(text), UNAVAILABLE);
    for (const secret of secrets) assert.equal(text.includes(secret), false, `body leaks ${secret}`);
    for (const [name, value] of res.headers) {
      for (const secret of secrets) {
        assert.equal(name.includes(secret) || value.includes(secret), false, `header ${name} leaks ${secret}`);
      }
    }
  }
});
