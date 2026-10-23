const { test } = require('node:test');
const assert = require('node:assert/strict');
const dgram = require('node:dgram');
const { EventEmitter } = require('node:events');
const os = require('node:os');
const { setTimeout: sleep } = require('node:timers/promises');
const realBonjour = require('bonjour-service');
const { startServer } = require('./helpers/server-harness');

// server.js advertises over Bonjour from inside its app.listen callback. A host whose own
// mDNS responder owns UDP 5353 without sharing it (Avahi, a NAS discovery service) makes the
// bind fail after construction, as an async 'error' event on multicast-dns. Nothing listened
// for it, so Node exited and a restart policy looped the container. Bonjour is a convenience:
// none of these failures may stop the server.

// A fixed advertise address keeps server.js off the real network interfaces, and a real port
// keeps bonjour-service from rejecting port 0.
const env = { PORT: '7777', ADVERTISE_HOST: 'arrview-test', ADVERTISE_IP: '192.0.2.10' };
// server.js overwrites os.networkInterfaces to pin the address it advertises, so it gets a copy.
const options = bonjour => ({ env, runListenCallback: true, modules: { os: { ...os }, 'bonjour-service': bonjour } });
const health = async s => (await fetch(s.base + '/api/health')).status;

async function waitFor(predicate, ms = 3000) {
  const deadline = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > deadline) assert.fail('timed out waiting for the expected log line');
    await sleep(20);
  }
}

// A UDP port that something else owns exclusively (no SO_REUSEADDR), as truenas-discoveryd
// owns 5353. A real socket, so the kernel raises a real EADDRINUSE for the real library.
async function occupiedUdpPort(t) {
  const holder = dgram.createSocket('udp4');
  await new Promise((resolve, reject) => { holder.once('error', reject); holder.bind(0, resolve); });
  t.after(() => holder.close());
  return holder.address().port;
}

test('a failed Bonjour bind is logged once and the server keeps serving', async t => {
  const port = await occupiedUdpPort(t);
  const started = [];
  class BonjourOnBusyPort extends realBonjour.Bonjour {
    constructor(opts, errorCallback) { super({ ...opts, port }, errorCallback); started.push(this); }
  }
  t.after(() => Promise.all(started.map(b => new Promise(resolve => b.destroy(resolve)))));

  const s = await startServer(t, options({ Bonjour: BonjourOnBusyPort }));
  await waitFor(() => s.logs.some(l => l.includes('iOS auto-discovery is unavailable')));
  // multicast-dns reports one failed bind twice, and publish() retries the bind while it probes
  // and announces. Give those retries time to land: they must neither throw nor log again.
  await sleep(1300);

  const lines = s.logs.filter(l => l.includes('iOS auto-discovery is unavailable'));
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^ {4}Bonjour: bind EADDRINUSE 0\.0\.0\.0:\d+ — another mDNS responder on this host/);
  assert.equal(await health(s), 200);
});

test('Bonjour errors handed back by the library are logged, not thrown', async t => {
  let errorCallback;
  const mdns = new EventEmitter();
  class FakeBonjour {
    constructor(opts, onError) { errorCallback = onError; this.server = { mdns }; }
    publish() {}
  }
  const s = await startServer(t, options({ Bonjour: FakeBonjour }));

  // Emitting 'error' with no listener throws, which is what used to end the process.
  assert.equal(mdns.listenerCount('error'), 1);
  const denied = Object.assign(new Error('bind EACCES 0.0.0.0:5353'), { code: 'EACCES' });
  assert.doesNotThrow(() => mdns.emit('error', denied));
  assert.doesNotThrow(() => mdns.emit('error', denied));
  // bonjour-service's default errorCallback rethrows; ours must not.
  const unreachable = Object.assign(new Error('send EHOSTUNREACH 224.0.0.251:5353'), { code: 'EHOSTUNREACH' });
  assert.equal(typeof errorCallback, 'function');
  assert.doesNotThrow(() => errorCallback(unreachable));
  assert.doesNotThrow(() => errorCallback(unreachable));

  assert.equal(s.logs.filter(l => l.includes('EACCES')).length, 1);
  assert.equal(s.logs.filter(l => l.includes('EHOSTUNREACH')).length, 1);
  assert.equal(await health(s), 200);
});

test('Bonjour failing to start is reported as that, not as a missing package', async t => {
  const failing = class { constructor() { throw new Error('socket creation failed'); } };
  const a = await startServer(t, options({ Bonjour: failing }));
  assert.ok(a.logs.some(l => l.includes("Bonjour: couldn't start (socket creation failed)")));
  assert.equal(a.logs.some(l => l.includes('not installed')), false);
  assert.equal(await health(a), 200);

  const missing = Object.assign(new Error("Cannot find module 'bonjour-service'"), { code: 'MODULE_NOT_FOUND' });
  const b = await startServer(t, options(missing));
  assert.ok(b.logs.some(l => l.includes('bonjour-service not installed')));
  assert.equal(await health(b), 200);
});

test('a working Bonjour is advertised as before', async t => {
  const published = [];
  // No `server` property: a library layout the error wiring does not know must not break startup.
  class FakeBonjour { publish(service) { published.push(service); } }
  const s = await startServer(t, options({ Bonjour: FakeBonjour }));

  // server.js runs in a vm realm, so its objects have another Object.prototype; compare as JSON.
  assert.deepEqual(JSON.parse(JSON.stringify(published)),
    [{ name: 'ArrView', type: 'arrview', port: 7777, host: 'arrview-test.local' }]);
  assert.ok(s.logs.includes('    Bonjour: advertising _arrview._tcp as arrview-test.local (192.0.2.10):7777'));
  assert.equal(s.logs.filter(l => l.includes('auto-discovery')).length, 0);
});
