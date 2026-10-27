import { useCallback, useEffect, useId, useRef, useState } from 'react'
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

const KEY_NAME_MAX = 40
const day = seconds => (seconds ? new Date(seconds * 1000).toLocaleDateString() : 'Never')

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
  const [confirm, setConfirm] = useState(null) // 'logout-all' | 'remove' | 'remove-all-keys' | { removeKey }
  const [keys, setKeys] = useState(null)
  const [keyName, setKeyName] = useState('')
  const [keyPassword, setKeyPassword] = useState('')
  const [fresh, setFresh] = useState(null) // { name, key }: a new key, shown until dismissed
  const [copied, setCopied] = useState('') // '' | 'Copied' | 'failed'
  const keyField = useRef(null)
  const on = Boolean(auth && auth.status && auth.status.required)

  const loadKeys = useCallback(async () => {
    try {
      const data = await call('/api/auth/keys', { method: 'GET' })
      setKeys(Array.isArray(data.keys) ? data.keys : [])
    } catch (e) { setError(e.message) }
  }, [])
  useEffect(() => { if (on) loadKeys() }, [on, loadKeys])

  if (!auth || !auth.status) return null
  const { status, refresh } = auth
  const locked = status.authDisabledByDocker || status.source === 'docker'

  const open = name => { setForm(name); setValues({}); setError('') }
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

  async function createKey(event) {
    event.preventDefault()
    if (keyName.trim().length > KEY_NAME_MAX) return setError(`The name can be at most ${KEY_NAME_MAX} characters`)
    if (!keyPassword) return setError('Enter your current password')
    setCopied('')
    const currentPassword = keyPassword
    setKeyPassword('') // cleared after every attempt, right or wrong
    if (await run(async () => {
      const made = await call('/api/auth/keys', { body: { name: keyName.trim(), currentPassword } })
      setFresh({ name: made.name, key: made.accessKey })
      setKeyName('')
    })) await loadKeys()
  }

  // The click copies the key already on screen: no request, no wait, so the browser still counts it as the user's own action.
  async function copyFresh() {
    setCopied((await copyText(fresh.key, keyField.current)) ? 'Copied' : 'failed')
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

      {on && <div className="key-section">
        <h3><Icon name="key" /> Keys for apps and scripts</h3>
        <p className="text-muted text-sm">Make one key for each app or script. A key is shown only once, when you make it; ArrView keeps nothing it could show again.</p>
        {keys && keys.length > 0 && <ul className="key-list">
          {keys.map(k => <li key={k.id}>
            <span className="key-name">{k.name}</span>
            <span className="text-muted text-sm">Created {day(k.created)} · Last used {day(k.lastUsed)}</span>
            <button className="btn btn-secondary" disabled={busy} aria-label={`Remove key ${k.name}`} onClick={() => setConfirm({ removeKey: k })}><Icon name="trash" /> Remove</button>
          </li>)}
        </ul>}
        {keys && keys.length === 0 && !fresh && <p className="text-muted text-sm">No keys yet.</p>}
        <form className="key-create" onSubmit={createKey}>
          <label htmlFor={`${idBase}-keyname`}>Key name (optional)</label>
          <input id={`${idBase}-keyname`} type="text" maxLength={KEY_NAME_MAX} placeholder="App key" autoComplete="off" value={keyName} onChange={e => setKeyName(e.target.value)} />
          <PasswordFields idBase={`${idBase}-key`} values={{ currentPassword: keyPassword }} onChange={(_, value) => setKeyPassword(value)}
            fields={[['currentPassword', 'Current password', 'current-password']]} />
          <button type="submit" className="btn btn-secondary" disabled={busy}><Icon name="plus" /> Make a key</button>
        </form>
        {fresh && <div className="key-fresh" role="group" aria-label="New key">
          <label htmlFor={`${idBase}-newkey`}>New key for {fresh.name}</label>
          <div className="key-fresh-row">
            <input id={`${idBase}-newkey`} ref={keyField} type="text" readOnly value={fresh.key} spellCheck="false" autoComplete="off"
              onFocus={e => e.target.select()} />
            <button type="button" className="btn btn-secondary" onClick={copyFresh}><Icon name={copied === 'Copied' ? 'check' : 'copy'} /> {copied === 'Copied' ? 'Copied' : 'Copy'}</button>
          </div>
          <p className="text-sm" role="status">{copied === 'failed'
            ? 'Your browser would not copy it. The key is selected above: copy it by hand now. It will not be shown again.'
            : 'Copy it now. It will not be shown again.'}</p>
          <button type="button" className="btn btn-secondary" onClick={() => { setFresh(null); setCopied('') }}>Done</button>
        </div>}
        {keys && keys.length > 0 && <div className="security-actions">
          <button className="btn btn-secondary" disabled={busy} onClick={() => setConfirm('remove-all-keys')}><Icon name="trash" /> Remove all keys</button>
        </div>}
      </div>}
      {on && <p className="text-muted text-sm">The ArrView iOS and tvOS apps can’t sign in yet.</p>}

      {confirm && confirm.removeKey && <ConfirmSheet title={`Remove key ${confirm.removeKey.name}?`} description="The app or script using it will stop working at once."
        onClose={() => setConfirm(null)} actions={[{ label: 'Remove key', run: async () => { await call('/api/auth/keys/remove', { body: { id: confirm.removeKey.id } }); await loadKeys() } }]} />}
      {confirm === 'remove-all-keys' && <ConfirmSheet title="Remove all keys?" description="Every app and script using a key will stop working at once."
        onClose={() => setConfirm(null)} actions={[{ label: 'Remove all keys', run: async () => { await call('/api/auth/keys/remove-all'); setFresh(null); await loadKeys() } }]} />}
      {confirm === 'logout-all' && <ConfirmSheet title="Sign out everywhere?" description="Every browser, including this one, will have to sign in again. All app keys stop working too."
        onClose={() => setConfirm(null)} actions={[{ label: 'Sign out everywhere', run: async () => { await call('/api/auth/logout-all'); await refresh() } }]} />}
      {confirm === 'remove' && <ConfirmSheet title="Remove the password?" description="Anyone who can reach this address will be able to use ArrView without signing in."
        onClose={() => setConfirm(null)} actions={[{ label: 'Remove password', run: async () => { await call('/api/auth/password/remove', { body: { currentPassword: values.currentPassword } }); close(); await refresh() } }]} />}
    </section>
  )
}
