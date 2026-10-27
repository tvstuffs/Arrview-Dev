import { useEffect, useRef, useState } from 'react'
import './Security.css'
import Icon from './Icon.jsx'
import { apiFetch } from '../api'

const NETWORK_ERROR = 'Can’t reach your ArrView server. Check your connection and try again.'

export default function SignIn({ onSignedIn, expired = false }) {
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [blocked, setBlocked] = useState(false)
  const input = useRef(null)
  const timer = useRef(null)
  useEffect(() => () => clearTimeout(timer.current), [])

  async function submit(event) {
    event.preventDefault()
    if (pending || blocked) return
    setPending(true); setError('')
    let failure = ''
    try {
      const response = await apiFetch('/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }),
      })
      const body = await response.json().catch(() => ({}))
      if (response.ok) { onSignedIn(); return }
      failure = body.error || `Sign in failed (${response.status})`
      if (response.status === 429 && Number(body.retryAfterSeconds) > 0) {
        const seconds = Number(body.retryAfterSeconds)
        const minutes = Math.ceil(seconds / 60)
        failure = `${failure} Try again in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`
        setBlocked(true)
        timer.current = setTimeout(() => setBlocked(false), seconds * 1000)
      }
    } catch {
      failure = NETWORK_ERROR
    }
    setPending(false); setError(failure); setPassword('')
    input.current?.focus()
  }

  return (
    <main className="sign-in">
      <form className="card sign-in-card" onSubmit={submit}>
        <img className="sign-in-logo" src="/arrview-icon.svg" alt="ArrView" width="64" height="64" />
        <h1><Icon name="lock" /> Sign in</h1>
        {expired && !error && <p className="text-muted" role="status">Your session ended. Sign in again.</p>}
        {error && <p className="error-banner" role="alert">{error}</p>}
        <input type="text" name="username" autoComplete="username" value="ArrView" readOnly tabIndex={-1} aria-hidden="true" className="visually-hidden" />
        <div className="field-group">
          <label htmlFor="sign-in-password">Password</label>
          <input id="sign-in-password" ref={input} type="password" name="password" autoComplete="current-password" autoFocus required
            value={password} onChange={e => setPassword(e.target.value)} />
        </div>
        <button type="submit" className="btn btn-primary btn-lg" disabled={pending || blocked}>
          <Icon name="sign-in" /> {pending ? 'Signing in…' : 'Sign In'}
        </button>
      </form>
    </main>
  )
}
