// The image declares its data folder as a volume, so Docker makes /data (an anonymous volume) when nothing is mounted
// there and a run with no -v has a folder that saves. The volume must be the folder CONFIG_DIR names: a changed
// CONFIG_DIR with the old VOLUME line would bring the missing-folder failure back.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dockerfile = fs.readFileSync(path.join(__dirname, '..', 'Dockerfile'), 'utf8');
// The runtime stage is everything after the last FROM; comments and blank lines are dropped.
const lines = dockerfile.split(/^FROM /m).pop().split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#'));

// The paths a VOLUME line lists, in either form: VOLUME /data /other, or VOLUME ["/data", "/other"].
const volumes = () => lines.filter(line => /^VOLUME\s/i.test(line)).flatMap(line => {
  const rest = line.replace(/^VOLUME\s+/i, '');
  return rest.startsWith('[') ? JSON.parse(rest) : rest.split(/\s+/);
});

test('the runtime stage declares the CONFIG_DIR folder as a volume', () => {
  const env = lines.map(line => /^ENV\s+CONFIG_DIR[= ](\S+)$/i.exec(line)).find(Boolean);
  assert.ok(env, 'ENV CONFIG_DIR is set in the runtime stage');
  assert.equal(env[1], '/data');
  assert.deepEqual(volumes(), [env[1]]);
});

test('the volume is declared before anything that could write into it', () => {
  const at = lines.findIndex(line => /^VOLUME\s/i.test(line));
  assert.ok(at >= 0);
  // Changes a later RUN makes under a declared volume are thrown away, so none may touch it.
  for (const line of lines.slice(at + 1)) assert.ok(!(/^RUN\s/i.test(line) && /\/data\b/.test(line)), `a later step writes to /data: ${line}`);
});
