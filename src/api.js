// The one place the app talks to the server. Every call carries X-Requested-With: ArrView (the server's cross-site
// rule for cookie sessions), and a 401 that says the login is required is announced once so the app can show Sign in.
const listeners = new Set()
let announced = false

export function onAuthRequired(listener) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function resetAuthRequired() {
  announced = false
}

function withHeader(headers) {
  const out = new Headers(headers || undefined)
  out.set('X-Requested-With', 'ArrView')
  return out
}

async function noteAuthRequired(response) {
  if (announced || !response || response.status !== 401 || typeof response.clone !== 'function') return
  try {
    const body = await response.clone().json()
    if (!body || body.auth !== true || announced) return
    announced = true
    for (const listener of [...listeners]) listener()
  } catch (_) { /* not JSON: not an auth signal */ }
}

export async function apiFetch(url, options = {}) {
  const response = await fetch(url, { ...options, headers: withHeader(options.headers) })
  await noteAuthRequired(response)
  return response
}
