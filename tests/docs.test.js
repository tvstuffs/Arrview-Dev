// The public documentation stays complete and intact: every environment variable the server reads has a row with an
// example in the README's reference, and every relative link, image and in-page anchor in the docs resolves.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const DOCS = ['README.md', 'docs/API.md', 'docs/DEVELOPMENT.md'];

// The variables server.js reads: process.env.X, env.X (the resolvers take process.env as `env`), and the per-service
// names it builds as `ARRVIEW_${S}_URL`, `ARRVIEW_${S}_API_KEY` and `${keyVar}_FILE`, documented as ARRVIEW_<SVC>_...
function variablesTheServerReads() {
  const server = read('server.js');
  const names = new Set();
  for (const m of server.matchAll(/\b(?:process\.)?env\.([A-Z][A-Z0-9_]+)\b/g)) names.add(m[1]);
  for (const m of server.matchAll(/`ARRVIEW_\$\{\w+\}_([A-Z_]+)`/g)) names.add(`ARRVIEW_<SVC>_${m[1]}`);
  if (server.includes('`${keyVar}_FILE`')) names.add('ARRVIEW_<SVC>_API_KEY_FILE');
  return [...names].sort();
}

// The text under one heading, up to the next heading of the same or a higher level.
function section(markdown, heading) {
  const lines = markdown.split('\n');
  const start = lines.indexOf(heading);
  assert.ok(start >= 0, `no heading "${heading}"`);
  const level = heading.match(/^#+/)[0].length;
  const end = lines.findIndex((line, i) => i > start && /^#+ /.test(line) && line.match(/^#+/)[0].length <= level);
  return lines.slice(start + 1, end < 0 ? undefined : end).join('\n');
}

// GitHub's heading anchors: lower case, punctuation dropped, each space a hyphen.
const slug = text => text.trim().toLowerCase().replace(/<[^>]+>/g, '').replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');
const anchorsOf = markdown => new Set([...markdown.matchAll(/^#{1,6} (.+)$/gm)].map(m => slug(m[1])));
const targetsOf = markdown => [
  ...[...markdown.matchAll(/\]\(([^)\s]+)\)/g)].map(m => m[1]),
  ...[...markdown.matchAll(/<img [^>]*src="([^"]+)"/g)].map(m => m[1]),
];

test('the README reference has a row with a default, a meaning and an example for every variable the server reads', () => {
  const variables = variablesTheServerReads();
  assert.ok(variables.length >= 12, `the extraction found only: ${variables.join(', ')}`);
  for (const expected of ['PORT', 'CONFIG_DIR', 'ARRVIEW_HOST', 'ARRVIEW_<SVC>_URL', 'ARRVIEW_<SVC>_API_KEY', 'ARRVIEW_<SVC>_API_KEY_FILE',
    'ARRVIEW_PASSWORD', 'ARRVIEW_PASSWORD_FILE', 'ARRVIEW_AUTH', 'ARRVIEW_TRUSTED_PROXIES', 'ADVERTISE_HOST', 'ADVERTISE_IP']) {
    assert.ok(variables.includes(expected), `the extraction missed ${expected}`);
  }
  const rows = section(read('README.md'), '### Environment variables').split('\n').filter(line => line.startsWith('| `'));
  for (const name of variables) {
    const row = rows.find(line => line.startsWith(`| \`${name}\` |`));
    assert.ok(row, `${name} has no row in the README's Environment variables table`);
    const cells = row.split('|').slice(1, -1).map(cell => cell.trim());
    assert.equal(cells.length, 4, `${name}: the row needs the variable, a default, what it does and an example`);
    assert.ok(cells[2].length > 20, `${name}: the row does not say what it does`);
    assert.match(cells[3], /^`[A-Z_<>]+=[^`]+`$/, `${name}: the example column needs an example such as \`${name}=...\``);
  }
});

test('every relative link and image in the README and docs/ points at a file that exists', () => {
  for (const file of DOCS) {
    for (const target of targetsOf(read(file))) {
      if (/^(https?:|mailto:|#)/.test(target)) continue;
      const local = decodeURIComponent(target.split('#')[0]);
      assert.ok(fs.existsSync(path.join(root, path.dirname(file), local)), `${file} links to ${target}, which does not exist`);
    }
  }
});

test('every in-page link in the docs leads to a heading that exists', () => {
  for (const file of DOCS) {
    for (const target of targetsOf(read(file))) {
      const [page, anchor] = target.split('#');
      if (anchor === undefined || /^https?:/.test(target)) continue;
      const into = page ? path.join(path.dirname(file), decodeURIComponent(page)) : file;
      assert.ok(anchorsOf(read(into)).has(anchor), `${file} links to #${anchor} in ${into}, which has no such heading`);
    }
  }
});

test('the README shows the screenshots that docs/screenshots holds, each with a description', () => {
  const readme = read('README.md');
  const shown = [...readme.matchAll(/<img src="docs\/screenshots\/([^"]+)" alt="([^"]*)"/g)];
  assert.ok(shown.length >= 6, `only ${shown.length} screenshots are shown`);
  for (const [, file, alt] of shown) assert.ok(alt.length >= 10, `docs/screenshots/${file} has no real description`);
  const files = fs.readdirSync(path.join(root, 'docs', 'screenshots')).filter(name => !name.startsWith('.'));
  assert.deepEqual(files.sort(), shown.map(([, file]) => file).sort(), 'docs/screenshots holds files the README does not show');
});
