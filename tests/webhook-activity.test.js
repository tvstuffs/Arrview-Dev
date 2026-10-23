const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { setTimeout: sleep } = require('node:timers/promises');
const { startServer } = require('./helpers/server-harness');

// GET /api/webhooks/last tells Settings what Sonarr and Radarr last delivered. It is kept in memory, per
// service, with the last event and the last Test message apart, and the server works out the ages itself.

const last = async s => (await fetch(s.base + '/api/webhooks/last')).json();
const send = (s, service, body, headers) => s.json('POST', `/api/webhooks/${service}`, body, headers);
const empty = { event: null, test: null };
// Just recorded: a whole number of seconds, 0 at first.
function recent(seen, eventType) {
  assert.ok(seen, `expected ${eventType}, got ${JSON.stringify(seen)}`);
  assert.deepEqual(Object.keys(seen).sort(), ['ageSeconds', 'eventType']);
  assert.equal(seen.eventType, eventType);
  assert.ok(Number.isInteger(seen.ageSeconds) && seen.ageSeconds >= 0 && seen.ageSeconds <= 5, `age ${seen.ageSeconds}`);
}

test('a server that has received nothing says so, and how long it has been up', async t => {
  const s = await startServer(t);
  const r = await fetch(s.base + '/api/webhooks/last');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  const body = await r.json();
  assert.deepEqual(Object.keys(body).sort(), ['radarr', 'sonarr', 'uptimeSeconds']);
  assert.ok(Number.isInteger(body.uptimeSeconds) && body.uptimeSeconds >= 0 && body.uptimeSeconds <= 5);
  assert.deepEqual(body.sonarr, empty);
  assert.deepEqual(body.radarr, empty);
});

test('an event is remembered for its own service, and a Test message is kept apart from it', async t => {
  const s = await startServer(t);
  assert.equal((await send(s, 'sonarr', { eventType: 'Download', series: { id: 1, title: 'Show' }, episodes: [{ id: 5 }] })).status, 200);
  let body = await last(s);
  recent(body.sonarr.event, 'Download');
  assert.equal(body.sonarr.test, null);
  assert.deepEqual(body.radarr, empty);

  // A Test message is noted, and does not hide the last real event.
  assert.equal((await send(s, 'sonarr', { eventType: 'Test', series: { id: 1, title: 'Show' } })).status, 200);
  body = await last(s);
  recent(body.sonarr.event, 'Download');
  recent(body.sonarr.test, 'Test');

  // A later event replaces the event and leaves the Test message alone.
  assert.equal((await send(s, 'sonarr', { eventType: 'Rename', series: { id: 1 } })).status, 200);
  body = await last(s);
  recent(body.sonarr.event, 'Rename');
  recent(body.sonarr.test, 'Test');

  // Radarr has its own, and Sonarr's did not move.
  assert.equal((await send(s, 'radarr', { eventType: 'MovieAdded', movie: { id: 2, title: 'Movie' } })).status, 200);
  body = await last(s);
  recent(body.radarr.event, 'MovieAdded');
  assert.equal(body.radarr.test, null);
  recent(body.sonarr.event, 'Rename');
  assert.equal((await send(s, 'radarr', { eventType: 'Test' })).status, 200);
  body = await last(s);
  recent(body.radarr.test, 'Test');
  recent(body.radarr.event, 'MovieAdded');
});

test('what was recorded gets older, and so does the server', async t => {
  const s = await startServer(t);
  await send(s, 'sonarr', { eventType: 'Download' });
  await send(s, 'sonarr', { eventType: 'Test' });
  await sleep(1100);
  const body = await last(s);
  for (const seen of [body.sonarr.event, body.sonarr.test]) {
    assert.ok(seen.ageSeconds >= 1 && seen.ageSeconds <= 5, `age ${seen.ageSeconds}`);
  }
  assert.ok(body.uptimeSeconds >= 1 && body.uptimeSeconds <= 6, `uptime ${body.uptimeSeconds}`);
  assert.ok(body.uptimeSeconds >= body.sonarr.event.ageSeconds);
});

test('only plain-letter event types are kept, and the answer is the same either way', async t => {
  const s = await startServer(t);
  // Webhook calls are not authenticated, so what is shown in Settings is limited to what no one can abuse.
  const refused = ['<b>x</b>', 'Down load', 'Download1', 'Down-load', 'a'.repeat(41), '', 42, null, true, ['Download'],
    { eventType: 'Download' }, 'Téléchargement', 'Down\nload', '<script>alert(1)</script>'];
  for (const eventType of refused) {
    assert.equal((await send(s, 'sonarr', { eventType })).status, 200, JSON.stringify(eventType));
    assert.equal((await send(s, 'radarr', { eventType })).status, 200, JSON.stringify(eventType));
  }
  const body = await last(s);
  assert.deepEqual(body.sonarr, empty);
  assert.deepEqual(body.radarr, empty);

  // The longest accepted type, and the shortest.
  await send(s, 'sonarr', { eventType: 'a'.repeat(40) });
  recent((await last(s)).sonarr.event, 'a'.repeat(40));
  await send(s, 'sonarr', { eventType: 'X' });
  recent((await last(s)).sonarr.event, 'X');
});

test('a body that is not an event, or not JSON, changes nothing', async t => {
  const s = await startServer(t);
  assert.equal((await send(s, 'sonarr', 'eventType=Download', { 'Content-Type': 'text/plain' })).status, 200);
  assert.equal((await send(s, 'sonarr', {})).status, 200);
  assert.equal((await send(s, 'sonarr', [])).status, 200);
  assert.equal((await send(s, 'radarr', { movie: { id: 1, title: 'No event type' } })).status, 200);
  const broken = await send(s, 'sonarr', '{"eventType": "Download", ', { 'Content-Type': 'application/json' });
  assert.equal(broken.status, 400);
  assert.deepEqual(await broken.json(), { error: 'Invalid JSON' });
  const body = await last(s);
  assert.deepEqual(body.sonarr, empty);
  assert.deepEqual(body.radarr, empty);
});

test('open pages are still told about real events and still not about Test messages', async t => {
  const s = await startServer(t);
  const chunks = [];
  const request = http.get(s.base + '/api/events', response => response.on('data', chunk => chunks.push(String(chunk))));
  t.after(() => request.destroy());
  await new Promise(resolve => request.once('response', resolve));

  await send(s, 'sonarr', { eventType: 'Test', series: { id: 1, title: 'Test show' } });
  await send(s, 'sonarr', { eventType: 'Download', series: { id: 1, title: 'Show' }, episodes: [{ id: 5 }] });
  await send(s, 'radarr', { eventType: 'Test', movie: { id: 2, title: 'Test movie' } });
  await send(s, 'radarr', { eventType: 'MovieAdded', movie: { id: 2, title: 'Movie' } });
  await sleep(250);

  const events = [...chunks.join('').matchAll(/^event: (\w+)\ndata: (.*)$/gm)].map(match => [match[1], JSON.parse(match[2])]);
  assert.deepEqual(events, [
    ['sonarr', { eventType: 'Download', seriesId: 1, seriesTitle: 'Show', episodeIds: [5] }],
    ['radarr', { eventType: 'MovieAdded', movieId: 2, movieTitle: 'Movie' }],
  ]);
  // Both kinds were noted all the same.
  const body = await last(s);
  recent(body.sonarr.event, 'Download'); recent(body.sonarr.test, 'Test');
  recent(body.radarr.event, 'MovieAdded'); recent(body.radarr.test, 'Test');
});

test('each server starts with its own empty record', async t => {
  const first = await startServer(t);
  await send(first, 'sonarr', { eventType: 'Download' });
  recent((await last(first)).sonarr.event, 'Download');
  const second = await startServer(t);
  assert.deepEqual((await last(second)).sonarr, empty);
});
