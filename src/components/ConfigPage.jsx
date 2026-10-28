import { useState, useEffect, useMemo } from 'react'
import './ConfigPage.css'
import InstallHelp from './InstallHelp.jsx'
import DiscoveryNotice from './DiscoveryNotice.jsx'
import WebhookSettings from './WebhookSettings.jsx'
import SecurityCard from './SecurityCard.jsx'
import Icon from './Icon.jsx'
import { normalizeAddress } from '../webhooks'
import { useWebhookActivity } from '../hooks/useWebhookActivity'
import { useServiceStatus } from '../hooks/useServiceStatus'
import { apiFetch } from '../api'

const SERVICES = [
  {
    id: 'sabnzbd',
    name: 'SABnzbd',
    icon: 'tray-arrow-down',
    description: 'Usenet downloader',
    placeholder: 'http://localhost:8080',
  },
  {
    id: 'nzbhydra',
    name: 'NZBHydra',
    icon: 'magnifying-glass',
    description: 'Usenet search aggregator',
    placeholder: 'http://localhost:5076',
  },
  {
    id: 'sonarr',
    name: 'Sonarr',
    icon: 'television-simple',
    description: 'TV show management',
    placeholder: 'http://localhost:8989',
  },
  {
    id: 'radarr',
    name: 'Radarr',
    icon: 'film-slate',
    description: 'Movie management',
    placeholder: 'http://localhost:7878',
  },
]

const MASK_PREFIX = '\u2022\u2022\u2022\u2022'

const KEY_ALNUM_ERROR = 'API key must contain at least one letter or number.'
const WEBHOOK_ADDRESS_ERROR = 'The ArrView address for webhooks must look like http://host:7777, without a query or login details.'
const isMasked = key => String(key || '').startsWith(MASK_PREFIX)
const hasUsableKey = key => isMasked(key) || /[A-Za-z0-9]/.test(String(key || ''))
const sendKey = key => (isMasked(key) ? key : String(key || '').trim())

// What a service row says about its connection: the last Test wins, then the background ping of a saved service.
function connectionOf({ saved, ping, testResult }) {
  if (testResult) return testResult.success
    ? { tone: 'ok', text: `Connected${testResult.version ? ` · v${testResult.version}` : ''}` }
    : { tone: 'bad', text: 'Test failed' }
  if (!saved) return { tone: 'off', text: 'Not set up' }
  if (ping === 'online') return { tone: 'ok', text: 'Connected' }
  if (ping === 'offline') return { tone: 'bad', text: 'Can’t connect' }
  return { tone: 'off', text: 'Checking…' }
}

// One row of the Services list: name, description and connection status; it opens to the address and key fields.
// A saved service starts closed, one that is not set up starts open. Closed fields stay in the page (hidden).
function ServiceRow({ service, values, saved, ping, onChange, onTest, envManaged = false, keyHint = false }) {
  const [open, setOpen] = useState(!saved)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)

  async function handleTest() {
    setTesting(true)
    setTestResult(null)
    const result = await onTest(service.id, values.url, values.apikey)
    setTestResult(result)
    setTesting(false)
  }

  const hasCredentials = values.url && hasUsableKey(values.apikey)
  const noteId = `${service.id}-env-note`
  const hintId = `${service.id}-key-hint`
  const panelId = `${service.id}-panel`
  const connection = connectionOf({ saved, ping, testResult })

  return (
    <li className={`service-row${open ? ' is-open' : ''}`}>
      <button type="button" className="service-row-head" aria-label={service.name} aria-describedby={`${service.id}-desc ${service.id}-status`}
        aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(value => !value)}>
        <span className="service-icon"><Icon name={service.icon} /></span>
        <span className="service-row-text">
          <span className="service-name">{service.name}</span>
          <span className="service-desc" id={`${service.id}-desc`}>{service.description}</span>
        </span>
        <span className={`service-status is-${connection.tone}`} id={`${service.id}-status`}><span className="service-dot" aria-hidden="true" />{connection.text}</span>
        <Icon name="caret-down" className="icon service-caret" />
      </button>

      <div className="service-panel" id={panelId} role="group" aria-label={`${service.name} connection`} hidden={!open}>
        {envManaged && (
          <p id={noteId} className="text-sm text-muted">
            Set in the Docker configuration (ARRVIEW_{service.id.toUpperCase()}_* environment variables).
            To change it, edit your compose file, .env or secret file and recreate the container
            with <code>docker compose up -d</code>. No image rebuild is needed.
          </p>
        )}

        <div className="service-field">
          <label htmlFor={`${service.id}-url`}>Server URL</label>
          <input
            id={`${service.id}-url`} type="url"
            placeholder={service.placeholder}
            value={values.url || ''}
            readOnly={envManaged}
            aria-describedby={envManaged ? noteId : undefined}
            onChange={e => onChange(service.id, 'url', e.target.value)}
          />
        </div>
        <div className="service-field">
          <label htmlFor={`${service.id}-key`}>API Key</label>
          <div className="input-group">
            <input
              id={`${service.id}-key`} type="password"
              placeholder="Enter API key…"
              value={values.apikey || ''}
              readOnly={envManaged}
              aria-describedby={envManaged ? noteId : (keyHint ? hintId : undefined)}
              onChange={e => onChange(service.id, 'apikey', e.target.value)}
            />
            <button
              type="button"
              className="btn btn-secondary"
              disabled={!hasCredentials || testing}
              onClick={handleTest}
            >
              {testing ? <span className="spinner" style={{width:14,height:14}} /> : 'Test'}
            </button>
          </div>
        </div>

        {keyHint && !envManaged && (
          <div id={hintId} className="text-sm text-muted">Re-enter the API key for the new address.</div>
        )}

        {testResult && !testResult.success && (
          <div className="error-banner" style={{fontSize: 12}}>
            {testResult.error}
          </div>
        )}
      </div>
    </li>
  )
}

export default function ConfigPage({ initialConfig = {}, onSave, onBack, layout, onLayoutChange, hideHeader = false }) {
  const [config, setConfig] = useState(() => ({
    sabnzbd:  { url: '', apikey: '', ...initialConfig.sabnzbd  },
    nzbhydra: { url: '', apikey: '', ...initialConfig.nzbhydra },
    sonarr:   { url: '', apikey: '', ...initialConfig.sonarr   },
    radarr:   { url: '', apikey: '', ...initialConfig.radarr   },
  }))
  const envManaged = initialConfig.envManaged || {}
  // ArrView's own address as Sonarr and Radarr reach it; empty means this page's address.
  const savedAddress = initialConfig.webhooks?.baseUrl || ''
  const [webhookAddress, setWebhookAddress] = useState(savedAddress)
  const savedService = id => Boolean(initialConfig[id]?.url && hasUsableKey(initialConfig[id].apikey))
  // The rows ping only saved services. The key changes only when a saved address does, so a page whose parent passes
  // a new object on every render does not restart the pings (or loop).
  const pingKey = SERVICES.map(s => (savedService(s.id) ? `${s.id}=${initialConfig[s.id].url}` : '')).join('|')
  const pingConfig = useMemo(() => Object.fromEntries(SERVICES.filter(s => savedService(s.id)).map(s => [s.id, initialConfig[s.id]])), [pingKey])
  const { status: ping } = useServiceStatus(pingConfig)
  // What Sonarr and Radarr last delivered is only asked for while their card is on the page.
  const webhookActivity = useWebhookActivity(savedService('sonarr') || savedService('radarr'))
  const [keyHints, setKeyHints] = useState({})
  // Set when an address edit cleared a masked key; only cleared once a key is present at Save time.
  const [keyRequired, setKeyRequired] = useState({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [version, setVersion] = useState(null)
  const [bonjour, setBonjour] = useState(null)

  useEffect(() => {
    let cancelled = false
    apiFetch('/api/arrview/identify')
      .then(r => r.json())
      .then(d => { if (!cancelled) { setVersion(d.version); setBonjour(d.bonjour || null) } })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  function handleChange(service, field, value) {
    if (envManaged[service]) return
    const clearKey = field === 'url' && String(config[service].apikey || '').startsWith(MASK_PREFIX)
    setConfig(prev => ({
      ...prev,
      [service]: { ...prev[service], [field]: value, ...(clearKey ? { apikey: '' } : {}) },
    }))
    if (clearKey) {
      setKeyHints(prev => ({ ...prev, [service]: true }))
      setKeyRequired(prev => ({ ...prev, [service]: true }))
    }
    else if (field === 'apikey') setKeyHints(prev => ({ ...prev, [service]: false }))
  }

  async function handleTest(serviceId, url, apikey) {
    try {
      const normalizedUrl = url && !url.match(/^https?:\/\//) ? `http://${url}` : url
      const r = await apiFetch(`/api/test/${serviceId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: normalizedUrl, apikey: sendKey(apikey) }),
      })
      const data = await r.json()
      return data.success ? data : { success: false, error: data.error }
    } catch (e) {
      return { success: false, error: 'Request failed' }
    }
  }

  async function handleSave() {
    if (SERVICES.some(s => !envManaged[s.id] && config[s.id].url.trim() && config[s.id].apikey &&
        !hasUsableKey(config[s.id].apikey))) {
      setError(KEY_ALNUM_ERROR)
      return
    }
    const hasAny = SERVICES.some(s => config[s.id].url && hasUsableKey(config[s.id].apikey))
    if (!hasAny) {
      setError('Configure at least one service before saving.')
      return
    }
    if (SERVICES.some(s => !envManaged[s.id] && keyRequired[s.id] && config[s.id].url.trim() && !config[s.id].apikey)) {
      setError('Re-enter the API key for the new address.')
      return
    }
    // Sent only when it changed, so saving anything else behaves exactly as it did before webhooks had an address.
    const addressChanged = webhookAddress.trim() !== savedAddress.trim()
    if (addressChanged && webhookAddress.trim() && !normalizeAddress(webhookAddress)) {
      setError(WEBHOOK_ADDRESS_ERROR)
      return
    }
    setSaving(true)
    setError(null)
    try {
      const cleanConfig = {}
      SERVICES.forEach(s => {
        if (config[s.id].url && hasUsableKey(config[s.id].apikey)) {
          let url = config[s.id].url.replace(/\/$/, '')
          if (!url.match(/^https?:\/\//)) url = `http://${url}`
          cleanConfig[s.id] = { url, apikey: sendKey(config[s.id].apikey) }
          if (s.id === 'sabnzbd' && config.sabnzbd.sabPath && !envManaged.sabnzbd) {
            cleanConfig.sabnzbd.sabPath = config.sabnzbd.sabPath
          }
        }
      })
      if (addressChanged) cleanConfig.webhooks = { baseUrl: normalizeAddress(webhookAddress) || '' }
      const r = await apiFetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cleanConfig),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok || !data.success) throw new Error(data.error || 'Save failed')
      const saved = await apiFetch('/api/config', { cache: 'no-store' })
      if (!saved.ok) throw new Error('Settings saved, but could not reload them. Please retry.')
      await onSave(await saved.json())
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="config-page">
      <div className="config-container">
        {!hideHeader && <header className="config-header">
          <img className="config-logo" src="/arrview-icon.svg" alt="ArrView" width="72" height="72" />
          <h1>ArrView</h1>
          <p className="text-secondary">
            Configure your media server connections to get started.
            Enter the URL and API key for each service you want to monitor.
          </p>
        </header>}

        <SecurityCard />

        {layout && onLayoutChange && <fieldset className="layout-choice">
          <legend>Layout</legend>
          <div className="segmented">
            {[['modern', 'Modern'], ['classic', 'Classic']].map(([value, label]) => <label key={value} className={layout === value ? 'is-on' : undefined}>
              <input type="radio" name="layout" value={value} checked={layout === value} onChange={() => onLayoutChange(value)} /><span>{label}</span>
            </label>)}
          </div>
        </fieldset>}

        <DiscoveryNotice bonjour={bonjour} />

        <section className="settings-section" aria-labelledby="settings-services">
          <h2 id="settings-services">Services</h2>
          <p className="text-muted text-sm">The address and API key ArrView uses for each app. Open a row to change it; Save applies every change.</p>
          <ul className="service-list">
            {SERVICES.map(service => (
              <ServiceRow
                key={service.id}
                service={service}
                values={config[service.id]}
                saved={savedService(service.id)}
                ping={ping[service.id]}
                onChange={handleChange}
                onTest={handleTest}
                envManaged={Boolean(envManaged[service.id])}
                keyHint={Boolean(keyHints[service.id])}
              />
            ))}
          </ul>
        </section>

        <WebhookSettings address={webhookAddress} onAddressChange={setWebhookAddress}
          sonarr={savedService('sonarr')} radarr={savedService('radarr')} activity={webhookActivity} />

        <InstallHelp />

        {error && <div className="error-banner">{error}</div>}

        <div className="config-footer">
          {!onBack && (
            <p className="text-sm text-muted">
              You can update these settings later via the Settings button in the dashboard.
            </p>
          )}
          <div className="config-footer-actions">
            {onBack && (
              <button className="btn btn-secondary btn-lg" onClick={onBack} disabled={saving}>
                <Icon name="caret-left" /> Back
              </button>
            )}
            <button
              className="btn btn-primary btn-lg"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? <><span className="spinner" style={{width:16,height:16}} /> Saving…</> : 'Save'}
            </button>
          </div>
          {version && (
            <p className="config-version text-sm text-muted">ArrView v{version}</p>
          )}
        </div>
      </div>
    </div>
  )
}
