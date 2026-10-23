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
