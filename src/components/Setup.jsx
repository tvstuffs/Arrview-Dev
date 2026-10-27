import { useId, useState } from 'react'
import './Security.css'
import Icon from './Icon.jsx'
import { apiFetch } from '../api'
import { validatePassword, passwordError } from '../passwordRules'

const NETWORK_ERROR = 'Can’t reach your ArrView server. Check your connection and try again.'

// The first-run screen of a new install, shown before anything else (Modern and Classic alike, since it sits above both):
// protect ArrView with a password, or continue without one.
export default function Setup({ onDone }) {
  const idBase = useId()
  const [mode, setMode] = useState('choose') // 'choose' | 'password'
  const [values, setValues] = useState({})
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  async function send(path, body) {
    setPending(true); setError('')
    try {
      const response = await apiFetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store' })
      const data = await response.json().catch(() => ({}))
      if (response.ok) { onDone(); return }
      setError(data.error || `Request failed (${response.status})`)
    } catch {
      setError(NETWORK_ERROR)
    }
    setPending(false)
  }

  function save(event) {
    event.preventDefault()
    const checked = validatePassword(values.newPassword, 'settings')
    if (!checked.ok) return setError(passwordError(checked))
    if (values.newPassword !== values.confirmPassword) return setError('The two passwords don’t match')
    return send('/api/auth/password', { newPassword: values.newPassword })
  }

  const set = key => e => setValues(v => ({ ...v, [key]: e.target.value }))

  return (
    <main className="sign-in">
      <div className="card sign-in-card setup-card">
        <img className="sign-in-logo" src="/arrview-icon.svg" alt="ArrView" width="64" height="64" />
        <h1><Icon name="shield-check" /> Protect ArrView?</h1>
        <p>Without a password, anyone who can reach this address can use ArrView, including deleting files from your library.</p>
        {error && <p className="error-banner" role="alert">{error}</p>}
        {mode === 'choose' ? (
          <div className="setup-actions">
            <button type="button" className="btn btn-primary btn-lg" disabled={pending} onClick={() => setMode('password')}><Icon name="lock" /> Protect with a password</button>
            <button type="button" className="btn btn-secondary btn-lg" disabled={pending} onClick={() => send('/api/auth/setup/skip', {})}>Continue without a password</button>
            <p className="text-muted text-sm">You can set or remove a password later in Settings.</p>
          </div>
        ) : (
          <form onSubmit={save} className="setup-actions">
            <input type="text" name="username" autoComplete="username" value="ArrView" readOnly tabIndex={-1} aria-hidden="true" className="visually-hidden" />
            <div className="field-group">
              <label htmlFor={`${idBase}-new`}>New password</label>
              <input id={`${idBase}-new`} type="password" name="newPassword" autoComplete="new-password" autoFocus value={values.newPassword || ''} onChange={set('newPassword')} />
            </div>
            <div className="field-group">
              <label htmlFor={`${idBase}-confirm`}>Confirm new password</label>
              <input id={`${idBase}-confirm`} type="password" name="confirmPassword" autoComplete="new-password" value={values.confirmPassword || ''} onChange={set('confirmPassword')} />
            </div>
            <button type="submit" className="btn btn-primary btn-lg" disabled={pending}>Save password</button>
            <button type="button" className="btn btn-secondary" disabled={pending} onClick={() => { setMode('choose'); setError('') }}>Back</button>
          </form>
        )}
      </div>
    </main>
  )
}
