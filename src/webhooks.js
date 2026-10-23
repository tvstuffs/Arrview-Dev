// Where Sonarr and Radarr send their events: ArrView's own address plus a fixed path per service.
export const WEBHOOK_PATHS = { sonarr: '/api/webhooks/sonarr', radarr: '/api/webhooks/radarr' }

export const webhookUrl = (base, service) => `${base}${WEBHOOK_PATHS[service]}`

// The rules are spelled out because browsers and Node disagree about what a URL parser lets through (Chromium
// turns the space in "http://bad host" into %20; Node refuses it), and because the address is also printed inside
// a shell command: only characters that mean nothing to a shell are allowed, which also rules out credentials,
// queries and fragments.
const HOST = /^(?:\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?)$/
const SAFE_BASE = /^https?:\/\/[A-Za-z0-9._[\]:-]+(?:\/[A-Za-z0-9._~%-]+)*$/

// The browser's copy of the server's normalizeWebhookBase (server.js): an http(s) address with a plain host name
// or IP address, an optional port and an optional plain path; a missing scheme read as http; trailing slashes
// dropped; and a pasted full webhook URL cut back to the address. Returns null when the text cannot be one.
export function normalizeAddress(raw) {
  let text = String(raw ?? '').trim()
  if (!text || /\s/.test(text)) return null
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = `http://${text}`
  text = text.replace(/\/+$/, '')
  try {
    const url = new URL(text)
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !HOST.test(url.hostname) || url.username || url.password) return null
  } catch { return null }
  text = text.replace(/^[a-z][a-z0-9+.-]*(?=:\/\/)/i, scheme => scheme.toLowerCase())
  const base = text.replace(/\/api\/webhooks(?:\/(?:sonarr|radarr))?$/i, '')
  if (base !== text) return normalizeAddress(base)
  return SAFE_BASE.test(text) ? text : null
}

// --- What the webhooks last delivered (GET /api/webhooks/last) ---

const EVENT_TYPE = /^[A-Za-z]{1,40}$/

// One entry of the server's answer, or null when it is not a usable one: a plain-letter type and an age in seconds.
const readSeen = value => (value && typeof value.eventType === 'string' && EVENT_TYPE.test(value.eventType)
  && Number.isFinite(value.ageSeconds) && value.ageSeconds >= 0)
  ? { eventType: value.eventType, ageSeconds: Math.floor(value.ageSeconds) } : null

// The server's answer in the shape the card uses, or null when it is not an answer to that request at all
// (a catch-all stub, another server, an error page that happened to be JSON).
export function readActivity(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  const services = ['sonarr', 'radarr']
  if (!services.some(name => body[name] && typeof body[name] === 'object')) return null
  const read = value => ({ event: readSeen(value?.event), test: readSeen(value?.test) })
  const uptime = body.uptimeSeconds
  return {
    uptimeSeconds: Number.isFinite(uptime) && uptime >= 0 ? Math.floor(uptime) : null,
    sonarr: read(body.sonarr),
    radarr: read(body.radarr),
  }
}

// "less than a minute ago", "1 minute ago", "3 hours ago", "2 days ago".
export function formatAge(seconds) {
  const whole = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0
  if (whole < 60) return 'less than a minute ago'
  const unit = (count, word) => `${count} ${word}${count === 1 ? '' : 's'} ago`
  if (whole < 3600) return unit(Math.floor(whole / 60), 'minute')
  if (whole < 86400) return unit(Math.floor(whole / 3600), 'hour')
  return unit(Math.floor(whole / 86400), 'day')
}

// The event types of Sonarr and Radarr in words. Download is the type of an import, and of an upgrade too.
const EVENT_LABELS = { Download: 'Download (file import)', Test: 'Test message' }
export function eventLabel(type) {
  if (EVENT_LABELS[type]) return EVENT_LABELS[type]
  const words = String(type).replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

// What one service last delivered, as one or two sentences: the last event (or that there was none since
// ArrView started) and, when there was one, the last Test message. `elapsed` is the seconds since the answer
// arrived, so the text stays right between polls.
export function describeActivity(seen, uptimeSeconds, elapsed = 0) {
  const ago = value => formatAge(value.ageSeconds + elapsed)
  const event = seen.event ? `${eventLabel(seen.event.eventType)}, ${ago(seen.event)}.`
    : uptimeSeconds == null ? 'No event yet.' : `No event since ArrView started ${formatAge(uptimeSeconds + elapsed)}.`
  return seen.test ? `${event} Test message received ${ago(seen.test)}.` : event
}
