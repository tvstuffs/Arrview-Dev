// Where a person's browser opens one of the apps behind ArrView: the address saved in Settings, as Classic's status pills open
// it. Only a set-up service (an address and a key) whose address is http(s) has one, and login details in the address are left
// out. A path (a series or a movie page) goes after the address, which may carry a base path, without doubling a slash.
// The browser opens the address itself, so it must be one the browser can reach (not a name only Docker resolves, say).
export function serviceHref(config, service, path = '') {
  const saved = config?.[service]
  if (!saved?.url || !saved?.apikey) return null
  let url
  try { url = new URL(String(saved.url).trim()) } catch { return null }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  url.username = ''
  url.password = ''
  const base = url.href.replace(/\/+$/, '')
  const rest = String(path).replace(/^\/+/, '')
  return rest ? `${base}/${rest}` : base
}
