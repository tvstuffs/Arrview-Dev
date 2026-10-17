// The server's version label, read from server.js so tests never hard-code it.
// Labels such as '1.9A1' are display text: never compare them numerically (clients
// detect features through the `capabilities` list in GET /api/arrview/identify).
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');
const match = /^const APP_VERSION = '([^']+)';$/m.exec(source);
if (!match) throw new Error('APP_VERSION not found in server.js');

module.exports = match[1];
