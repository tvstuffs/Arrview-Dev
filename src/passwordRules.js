// A copy of the server's validatePassword (server.js) with identical behaviour; both are tested against
// tests/fixtures/password-vectors.json. Returns { ok: true, value } or { ok: false, reason: 'blank' | 'length' }.
// Order: type, one trailing newline for the Docker file, 1024 code unit bound, NFKC, blank, then 8 to 256 on the normalised text.
export const PASSWORD_MIN = 8
export const PASSWORD_MAX = 256
export const LENGTH_ERROR = 'Password must be 8 to 256 characters'
export const BLANK_ERROR = "Password can't be only spaces"

export function validatePassword(raw, source) {
  if (typeof raw !== 'string') return { ok: false, reason: 'length' }
  let s = raw
  if (source === 'docker-file') s = s.replace(/\r?\n$/, '')
  if (s.length > 1024) return { ok: false, reason: 'length' }
  s = s.normalize('NFKC')
  if (/^\s*$/.test(s)) return { ok: false, reason: 'blank' }
  if (s.length < PASSWORD_MIN || s.length > PASSWORD_MAX) return { ok: false, reason: 'length' }
  return { ok: true, value: s }
}

export const passwordError = result => (result.ok ? '' : result.reason === 'blank' ? BLANK_ERROR : LENGTH_ERROR)
