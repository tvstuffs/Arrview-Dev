// The address rule of Settings, Services. An http:// address is taken to be a local one and must name its port; an https:// address is
// taken to be a public host name that leads to the app by name (a reverse proxy), so its port is optional and is used when given. Nothing
// here adds a default port: each app's usual port is only suggested in the message. (The ArrView apps and the Docker variables
// ARRVIEW_HOST and ARRVIEW_<SVC>_URL do assume a default port; this rule is for what is typed in Settings.)
//
// The server applies the same rule when it saves and when it tests an address (serviceUrlProblem in server.js). The two are tested against
// one table, tests/fixtures/service-urls.json, so they cannot drift apart.

export const DEFAULT_PORTS = { sabnzbd: 8080, nzbhydra: 5076, sonarr: 8989, radarr: 7878 }
const PORT_RANGE = 'The port must be a number from 1 to 65535.'

// The address as the server will read it: http:// when no scheme is typed, the scheme in lower case, no trailing slashes.
export function cleanAddress(raw) {
  let text = String(raw ?? '').trim()
  if (!text) return ''
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = `http://${text}`
  return text.replace(/^[a-z][a-z0-9+.-]*(?=:\/\/)/i, scheme => scheme.toLowerCase()).replace(/\/+$/, '')
}

// The sentence to show under the address field, or null when the rule has nothing to say: an empty field, an address that is not a usable
// http(s) address at all (the server says so when it is saved or tested), or one that follows the rule. An address that is already
// saved is left alone, so that settings saved before the rule keep saving; the rule is for a new or changed address.
// The port is read from the text, not from URL.port, which is empty for :80 on http and :443 on https even when it was typed.
export function addressProblem(raw, service, saved = '') {
  const text = cleanAddress(raw)
  // A query or fragment is refused by the server with its own sentence, before this rule is asked.
  if (!text || /[?#]/.test(text) || (saved && text === cleanAddress(saved))) return null
  let url
  try { url = new URL(text) } catch { return null }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname || url.username || url.password) return null
  const rest = text.slice(text.indexOf('://') + 3)
  const slash = rest.indexOf('/')
  const authority = slash === -1 ? rest : rest.slice(0, slash)
  const tail = slash === -1 ? '' : rest.slice(slash)
  const match = authority.match(/^(\[[^\]]*\]|[^:]*)(?::(\d*))?$/)
  if (!match) return null
  if (match[2]) {
    const port = Number(match[2])
    return port >= 1 && port <= 65535 ? null : PORT_RANGE
  }
  if (url.protocol === 'https:') return null
  return `Add the port, for example http://${match[1]}:${DEFAULT_PORTS[service]}${tail}. An https:// address needs none.`
}
