const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { setTimeout: sleep } = require('node:timers/promises');
const { startServer } = require('./helpers/server-harness');
const { startSeeded } = require('./helpers/auth-helpers');

// D95: the webhook receivers stay open (no secret, no login), and are bounded instead. A malformed event is a 400 and changes nothing;
// per service at most one refresh a second reaches the open pages, with the ids merged; an event keeps at most 200 ids; titles lose
// their control characters; the log line is limited to one a second. Cases W1-W6 from the 2026-11-24 scan, real timers.

const send = (s, service, body, headers) => s.json('POST', `/api/webhooks/${service}`, body, headers);
const MALFORMED = { error: 'Invalid webhook event' };

// An open event stream; events() parses what has arrived so far, bytes() its size.
async function stream(t, s, headers = {}) {
  const chunks = [];
  const request = http.get(s.base + '/api/events', { headers }, response => response.on('data', c => chunks.push(String(c))));
  t.after(() => request.destroy());
  const response = await new Promise(resolve => request.once('response', resolve));
  return {
    status: response.statusCode,
    text: () => chunks.join(''),
    events: () => [...chunks.join('').matchAll(/^event: (\w+)\ndata: (.*)$/gm)].map(m => [m[1], JSON.parse(m[2])]),
  };
}
const webhookLines = (logs, name = 'Sonarr') => logs.filter(line => line.startsWith(`[${name} webhook]`));
const consecutive = list => list.every((v, i) => i === 0 || v === list[i - 1] + 1);

test('W1/W-log: a flood of 200 events gives at most one refresh a second, merged, and as few log lines', async t => {
  const s = await startServer(t);
  const sse = await stream(t, s);
  const started = Date.now();
  for (let i = 1; i <= 200; i += 1) {
    const r = await send(s, 'sonarr', { eventType: 'Download', series: { id: 1, title: 'Show' },
      episodes: [{ id: 3 * i - 2 }, { id: 3 * i - 1 }, { id: 3 * i }] });
    assert.equal(r.status, 200);
  }
  const flood = Date.now() - started;
  await sleep(1200);
  const elapsed = Date.now() - started;
  const events = sse.events();
  const bound = 2 + Math.ceil(elapsed / 1000);
  assert.ok(events.length >= 1 && events.length <= bound, `${events.length} events in ${elapsed} ms`);
  assert.ok(events.length >= 2, 'the flood was merged into at least one later event');
  assert.deepEqual(events[0], ['sonarr', { eventType: 'Download', seriesId: 1, seriesTitle: 'Show', episodeIds: [1, 2, 3] }]);
  for (const [, data] of events) {
    assert.ok(data.episodeIds.length <= 200);
    assert.ok(consecutive(data.episodeIds), 'ids keep their arrival order');
    assert.equal(data.seriesId, 1);
  }
  // The first merged event starts right after the first one; when the whole flood landed in one window it is capped at 200.
  assert.equal(events[1][1].episodeIds[0], 4);
  if (flood < 900) assert.equal(events[1][1].episodeIds.length, 200);
  // W-log
  const lines = webhookLines(s.logs);
  assert.ok(lines.length >= 1 && lines.length <= bound, `${lines.length} log lines`);
  assert.equal(lines[0], '[Sonarr webhook] Download — series: Show');
  assert.ok(lines.some(line => / \(and \d+ more in the last second\)$/.test(line)), lines.join('\n'));
});

test('W2: one event with 6000 ids sends at most 200, in a small message', async t => {
  const s = await startServer(t);
  const sse = await stream(t, s);
  const episodes = Array.from({ length: 6000 }, (_, i) => ({ id: i + 1 }));
  assert.equal((await send(s, 'sonarr', { eventType: 'Download', series: { id: 1, title: 'Show' }, episodes })).status, 200);
  await sleep(200);
  const events = sse.events();
  assert.equal(events.length, 1);
  assert.deepEqual(events[0][1].episodeIds, Array.from({ length: 200 }, (_, i) => i + 1));
  const message = sse.text().split('\n\n').find(block => block.startsWith('event: sonarr'));
  assert.ok(Buffer.byteLength(message) < 4096, `${Buffer.byteLength(message)} bytes`);
});

test('W3: a body over the 100 kB limit is still a 413 (control)', async t => {
  const s = await startServer(t);
  const r = await send(s, 'sonarr', { eventType: 'Download', series: { title: 'x'.repeat(300 * 1024) } });
  assert.equal(r.status, 413);
});

test('W4: episodes that is not a list is a 400, and nothing is recorded, sent or logged with a stack', async t => {
  const s = await startServer(t);
  const sse = await stream(t, s);
  const lastBefore = await (await fetch(s.base + '/api/webhooks/last')).json();
  const logsBefore = s.logs.length;
  const r = await send(s, 'sonarr', '{"eventType":"Download","episodes":5}');
  assert.equal(r.status, 400);
  assert.deepEqual(await r.json(), MALFORMED);
  await sleep(150);
  const lastAfter = await (await fetch(s.base + '/api/webhooks/last')).json();
  assert.deepEqual(lastAfter.sonarr, lastBefore.sonarr);
  assert.deepEqual(sse.events(), []);
  const added = s.logs.slice(logsBefore);
  assert.ok(added.length <= 1, added.join('\n'));
  assert.ok(added.every(line => !/\n\s+at /.test(line) && !line.includes('Download')), added.join('\n'));
});

test('W5: with the login on, a library read and the stream need it and the webhook does not', async t => {
  const s = await startSeeded(t);
  assert.equal((await fetch(s.base + '/api/sonarr/series')).status, 401);
  assert.equal((await fetch(s.base + '/api/events')).status, 401);
  assert.equal((await send(s, 'sonarr', { eventType: 'Download', series: { id: 1, title: 'Show' } })).status, 200);
  assert.equal((await send(s, 'radarr', { eventType: 'MovieAdded', movie: { id: 2, title: 'Movie' } })).status, 200);
});

test('W6: with the login on, a signed-in stream still receives an unsigned webhook\'s event', async t => {
  const s = await startSeeded(t);
  const sse = await stream(t, s, { Cookie: s.seeded.cookie });
  assert.equal(sse.status, 200);
  assert.equal((await send(s, 'sonarr', { eventType: 'Download', series: { id: 1, title: 'Show' }, episodes: [{ id: 5 }] })).status, 200);
  await sleep(150);
  assert.deepEqual(sse.events(), [['sonarr', { eventType: 'Download', seriesId: 1, seriesTitle: 'Show', episodeIds: [5] }]]);
});

test('W-single: one event in a quiet second is sent at once in today\'s shape', async t => {
  const s = await startServer(t);
  const sse = await stream(t, s);
  await send(s, 'sonarr', { eventType: 'Download', series: { id: 1, title: 'Show' }, episodes: [{ id: 5 }] });
  await send(s, 'radarr', { eventType: 'MovieAdded', movie: { id: 2, title: 'Movie' } });
  await sleep(150);
  assert.deepEqual(sse.events(), [
    ['sonarr', { eventType: 'Download', seriesId: 1, seriesTitle: 'Show', episodeIds: [5] }],
    ['radarr', { eventType: 'MovieAdded', movieId: 2, movieTitle: 'Movie' }],
  ]);
  // The sample body in the README and in Settings.
  const fresh = await startServer(t);
  const other = await stream(t, fresh);
  const r = await send(fresh, 'sonarr', '{"eventType":"Download","series":{"title":"ArrView test"}}');
  assert.equal(r.status, 200);
  await sleep(150);
  assert.deepEqual(other.events(), [['sonarr', { eventType: 'Download', seriesId: null, seriesTitle: 'ArrView test', episodeIds: [] }]]);
});

test('W-merge: events inside the window are merged into one, with the id kept only when they agree', async t => {
  // Mixed series: the id and title become null, the ids are joined and the later type wins.
  let s = await startServer(t);
  let sse = await stream(t, s);
  await send(s, 'sonarr', { eventType: 'Download', series: { id: 1, title: 'One' }, episodes: [{ id: 1 }] });
  await send(s, 'sonarr', { eventType: 'Download', series: { id: 1, title: 'One' }, episodes: [{ id: 2 }] });
  await send(s, 'sonarr', { eventType: 'Rename', series: { id: 2, title: 'Two' }, episodes: [{ id: 3 }, { id: 2 }] });
  await sleep(100);
  assert.equal(sse.events().length, 1, 'only the first is sent at once');
  await sleep(1100);
  assert.deepEqual(sse.events(), [
    ['sonarr', { eventType: 'Download', seriesId: 1, seriesTitle: 'One', episodeIds: [1] }],
    ['sonarr', { eventType: 'Rename', seriesId: null, seriesTitle: null, episodeIds: [2, 3] }],
  ]);

  // The same series: kept, with the latest title.
  s = await startServer(t);
  sse = await stream(t, s);
  await send(s, 'sonarr', { eventType: 'Download', series: { id: 1, title: 'One' }, episodes: [{ id: 1 }] });
  await send(s, 'sonarr', { eventType: 'Download', series: { id: 1, title: 'One' }, episodes: [{ id: 2 }] });
  await send(s, 'sonarr', { eventType: 'Rename', series: { id: 1, title: 'One renamed' }, episodes: [{ id: 3 }] });
  await sleep(1300);
  assert.deepEqual(sse.events().map(([, data]) => data), [
    { eventType: 'Download', seriesId: 1, seriesTitle: 'One', episodeIds: [1] },
    { eventType: 'Rename', seriesId: 1, seriesTitle: 'One renamed', episodeIds: [2, 3] },
  ]);

  // Radarr follows the same rule, and a Test message neither opens nor joins a window.
  s = await startServer(t);
  sse = await stream(t, s);
  await send(s, 'radarr', { eventType: 'Test', movie: { id: 9, title: 'Test movie' } });
  await send(s, 'radarr', { eventType: 'MovieAdded', movie: { id: 2, title: 'Two' } });
  await send(s, 'radarr', { eventType: 'Download', movie: { id: 2, title: 'Two' } });
  await send(s, 'radarr', { eventType: 'Test', movie: { id: 9, title: 'Test movie' } });
  await send(s, 'radarr', { eventType: 'Rename', movie: { id: 3, title: 'Three' } });
  await sleep(1300);
  assert.deepEqual(sse.events(), [
    ['radarr', { eventType: 'MovieAdded', movieId: 2, movieTitle: 'Two' }],
    ['radarr', { eventType: 'Rename', movieId: null, movieTitle: null }],
  ]);
});

test('W-sanitise: event types must be plain letters, and titles lose their control characters', async t => {
  let s = await startServer(t);
  let sse = await stream(t, s);
  const refused = ['Down\nload', '<b>x</b>', 'Download1', 'a'.repeat(41), '', 42, ['Download'], null, { x: 1 }];
  for (const eventType of refused) {
    for (const service of ['sonarr', 'radarr']) {
      const r = await send(s, service, { eventType, series: { id: 1, title: 'Show' } });
      assert.equal(r.status, 400, JSON.stringify(eventType));
      assert.deepEqual(await r.json(), MALFORMED);
    }
  }
  // Not a JSON object, or no event type.
  for (const body of ['[]', '"Download"', '{}']) assert.equal((await send(s, 'sonarr', body)).status, 400, body);
  assert.equal((await send(s, 'sonarr', 'eventType=Download', { 'Content-Type': 'text/plain' })).status, 400);
  await sleep(100);
  assert.deepEqual(sse.events(), []);
  for (const eventType of refused.filter(v => typeof v === 'string' && v)) {
    assert.ok(!s.logs.some(line => line.includes(eventType)), eventType);
  }

  const before = s.logs.length;
  assert.equal((await send(s, 'sonarr', { eventType: 'Download', series: { id: 1, title: 'Show\n[Sonarr webhook] forged\u0007\u009b' } })).status, 200);
  await sleep(100);
  assert.deepEqual(sse.events(), [['sonarr', { eventType: 'Download', seriesId: 1, seriesTitle: 'Show[Sonarr webhook] forged', episodeIds: [] }]]);
  const added = s.logs.slice(before);
  assert.equal(added.length, 1);
  assert.ok(!/[\u0000-\u001f\u007f-\u009f]/.test(added[0]));
  assert.ok(!s.logs.some(line => line.split('\n').some(part => part.startsWith('[Sonarr webhook] forged'))));

  // A 300-character title is cut to 200; ids that are not positive whole numbers are dropped, duplicates once.
  s = await startServer(t);
  sse = await stream(t, s);
  await send(s, 'sonarr', { eventType: 'Download', series: { id: 1, title: 'y'.repeat(300) },
    episodes: [{ id: 5 }, { id: 5 }, { id: 0 }, { id: -1 }, { id: 1.5 }, { id: '6' }, null, 7, { id: 8 }] });
  await sleep(100);
  assert.deepEqual(sse.events(), [['sonarr', { eventType: 'Download', seriesId: 1, seriesTitle: 'y'.repeat(200), episodeIds: [5, 8] }]]);

  // A series id that is not a positive whole number, or a series that is not an object, counts as absent.
  s = await startServer(t);
  sse = await stream(t, s);
  await send(s, 'radarr', { eventType: 'Download', movie: { id: '2', title: 42 } });
  await sleep(100);
  assert.deepEqual(sse.events(), [['radarr', { eventType: 'Download', movieId: null, movieTitle: null }]]);
});

test('W-log: refusals are logged at most once a second, with a count of the ones not shown', async t => {
  const s = await startServer(t);
  const started = Date.now();
  for (let i = 0; i < 50; i += 1) assert.equal((await send(s, 'sonarr', { eventType: 'Bad1' })).status, 400);
  await sleep(1100);
  assert.equal((await send(s, 'sonarr', { eventType: 'Bad2' })).status, 400);
  const elapsed = Date.now() - started;
  const lines = webhookLines(s.logs);
  assert.ok(lines.length >= 2 && lines.length <= 2 + Math.ceil(elapsed / 1000), lines.join('\n'));
  assert.equal(lines[0], '[Sonarr webhook] refused a malformed event');
  assert.match(lines.at(-1), /^\[Sonarr webhook\] refused a malformed event \(and \d+ more in the last second\)$/);
  assert.ok(lines.every(line => !line.includes('Bad')));
});
