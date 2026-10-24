import { useId, useState } from 'react'
import './Security.css'
import Icon from './Icon.jsx'
import ConfirmSheet from './ConfirmSheet.jsx'
import { apiFetch } from '../api'
import { useAuth } from '../AuthContext'
import { copyText } from '../clipboard'
import { validatePassword, passwordError } from '../passwordRules'

const JSON_HEADERS = { 'Content-Type': 'application/json' }

async function call(path, { method = 'POST', body } = {}) {
  let response
  try {
    // POSTs always declare a JSON body, even an empty one: the server refuses a mutating call without it.
    const mutating = method !== 'GET'
    response = await apiFetch(path, { method, headers: mutating ? JSON_HEADERS : undefined, body: mutating ? JSON.stringify(body || {}) : undefined, cache: 'no-store' })
  } catch {
    throw new Error('Can’t reach your ArrView server. Check your connection and try again.')
  }
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`)
  return data
}

// Copies the key through a field that exists only for the copy, so the key is never part of the page.
async function copyKey(text) {
  const field = document.createElement('input')
  field.className = 'visually-hidden'
  field.value = text
  field.setAttribute('aria-hidden', 'true')
  field.readOnly = true
  document.body.appendChild(field)
  try { return await copyText(text, field) } finally { field.remove() }
}

function PasswordFields({ idBase, fields, values, onChange }) {
  return <>
    <input type="text" name="username" autoComplete="username" value="ArrView" readOnly tabIndex={-1} aria-hidden="true" className="visually-hidden" />
    {fields.map(([key, label, autoComplete]) => <div className="field-group" key={key}>
      <label htmlFor={`${idBase}-${key}`}>{label}</label>
      <input id={`${idBase}-${key}`} type="password" name={key} autoComplete={autoComplete} value={values[key] || ''}
        onChange={e => onChange(key, e.target.value)} />
    </div>)}
  </>
}

export default function SecurityCard() {
  const auth = useAuth()
  const idBase = useId()
  const [form, setForm] = useState(null) // 'set' | 'change' | 'remove'
  const [values, setValues] = useState({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(null) // 'regenerate' | 'logout-all' | 'remove'
  const [copied, setCopied] = useState('')
  if (!auth || !auth.status) return null
  const { status, refresh } = auth
  const locked = status.authDisabledByDocker || status.source === 'docker'
  const on = status.required

  const open = name => { setForm(name); setValues({}); setError(''); setCopied('') }
  const close = () => { setForm(null); setValues({}); setError('') }
  const change = (key, value) => setValues(v => ({ ...v, [key]: value }))

  async function run(action) {
    setBusy(true); setError('')
    try { await action(); return true } catch (e) { setError(e.message); return false } finally { setBusy(false) }
  }

  async function savePassword(event) {
    event.preventDefault()
    const checked = validatePassword(values.newPassword, 'settings')
    if (!checked.ok) return setError(passwordError(checked))
    if (values.newPassword !== values.confirmPassword) return setError('The two passwords don’t match')
    if (form === 'change' && !values.currentPassword) return setError('Enter your current password')
    const body = form === 'change' ? { currentPassword: values.currentPassword, newPassword: values.newPassword } : { newPassword: values.newPassword }
    if (await run(() => call('/api/auth/password', { body }))) { close(); await refresh() }
  }

  async function copyAccessKey() {
    setCopied('')
    await run(async () => {
      const { accessKey } = await call('/api/auth/access-key', { method: 'GET' })
      setCopied(await copyKey(accessKey) ? 'Copied' : 'Couldn’t copy')
    })
  }

  const simple = path => async () => { await call(path); await refresh() }
  const signOut = () => run(simple('/api/auth/logout'))

  const newFields = [['newPassword', 'New password', 'new-password'], ['confirmPassword', 'Confirm new password', 'new-password']]
  const lockNote = `${idBase}-lock`

  return (
    <section className="card security-card" aria-label="Security">
      <h2><Icon name={status.authDisabledByDocker ? 'warning' : on ? 'shield-check' : 'lock-open'} /> Security</h2>

      {status.authDisabledByDocker && <p className="security-notice" id={lockNote}>The login is turned off by ARRVIEW_AUTH=off in the Docker configuration, whatever else is set. Remove that variable and recreate the container to turn it back on.</p>}
      {!on && !status.authDisabledByDocker && <p>No password is set. Anyone who can reach this address can use ArrView, including deleting files from your library.</p>}
      {on && status.source === 'docker' && <p id={lockNote}>The password is set by the Docker configuration (ARRVIEW_PASSWORD or ARRVIEW_PASSWORD_FILE). To change or remove it, edit your compose file or secret file and recreate the container with docker compose up -d. No image rebuild is needed.</p>}
      {on && status.source !== 'docker' && <p>Password protection is on. This browser stays signed in for 30 days of use.</p>}

      {error && <p className="error-banner" role="alert">{error}</p>}

      {form === 'set' || form === 'change' ? (
        <form onSubmit={savePassword}>
          <PasswordFields idBase={idBase} values={values} onChange={change}
            fields={[...(form === 'change' ? [['currentPassword', 'Current password', 'current-password']] : []), ...newFields]} />
          <div className="security-actions">
            <button type="submit" className="btn btn-primary" disabled={busy}>{form === 'set' ? 'Save password' : 'Change password'}</button>
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={close}>Cancel</button>
          </div>
        </form>
      ) : form === 'remove' ? (
        <form onSubmit={e => { e.preventDefault(); if (!values.currentPassword) return setError('Enter your current password'); setError(''); setConfirm('remove') }}>
          <PasswordFields idBase={idBase} values={values} onChange={change} fields={[['currentPassword', 'Current password', 'current-password']]} />
          <div className="security-actions">
            <button type="submit" className="btn btn-danger" disabled={busy}>Remove password</button>
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={close}>Cancel</button>
          </div>
        </form>
      ) : (
        <div className="security-actions">
          {!on && !status.authDisabledByDocker && <button className="btn btn-primary" onClick={() => open('set')}><Icon name="lock" /> Set a password</button>}
          {on && <>
            <button className="btn btn-secondary" disabled={locked} aria-describedby={locked ? lockNote : undefined} onClick={() => open('change')}>Change password</button>
            <button className="btn btn-secondary" disabled={locked} aria-describedby={locked ? lockNote : undefined} onClick={() => open('remove')}>Remove password</button>
            <button className="btn btn-secondary" disabled={busy} onClick={signOut}><Icon name="sign-out" /> Sign out</button>
            <button className="btn btn-secondary" disabled={busy} onClick={() => setConfirm('logout-all')}><Icon name="sign-out" /> Sign out everywhere</button>
          </>}
          {status.authDisabledByDocker && <>
            <button className="btn btn-secondary" disabled aria-describedby={lockNote}>Set a password</button>
          </>}
        </div>
      )}

      {on && <div className="key-row">
        <Icon name="key" />
        <span>Access key for apps</span>
        <span className="key-mask" aria-hidden="true">••••••••••••••••</span>
        <button className="btn btn-secondary" disabled={busy} onClick={copyAccessKey}><Icon name={copied === 'Copied' ? 'check' : 'copy'} /> {copied === 'Copied' ? 'Copied' : 'Copy'}</button>
        <button className="btn btn-secondary" disabled={busy} onClick={() => setConfirm('regenerate')}><Icon name="arrows-clockwise" /> Regenerate</button>
        {copied === 'Couldn’t copy' && <span role="status">Couldn’t copy</span>}
      </div>}
      {on && <p className="text-muted text-sm">The ArrView iOS and tvOS apps can’t sign in yet.</p>}

      {confirm === 'regenerate' && <ConfirmSheet title="Regenerate access key?" description="Apps and scripts using the old key will stop working."
        onClose={() => setConfirm(null)} actions={[{ label: 'Regenerate key', run: async () => { await call('/api/auth/access-key/regenerate') } }]} />}
      {confirm === 'logout-all' && <ConfirmSheet title="Sign out everywhere?" description="Every browser, including this one, will have to sign in again. The access key stops working too."
        onClose={() => setConfirm(null)} actions={[{ label: 'Sign out everywhere', run: async () => { await call('/api/auth/logout-all'); await refresh() } }]} />}
      {confirm === 'remove' && <ConfirmSheet title="Remove the password?" description="Anyone who can reach this address will be able to use ArrView without signing in."
        onClose={() => setConfirm(null)} actions={[{ label: 'Remove password', run: async () => { await call('/api/auth/password/remove', { body: { currentPassword: values.currentPassword } }); close(); await refresh() } }]} />}
    </section>
  )
}
