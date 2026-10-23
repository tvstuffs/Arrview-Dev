import { useState, useEffect } from 'react'
import './ConfigPage.css'
import InstallHelp from './InstallHelp.jsx'
import DiscoveryNotice from './DiscoveryNotice.jsx'
import WebhookSettings from './WebhookSettings.jsx'
import Icon from './Icon.jsx'
import { normalizeAddress } from '../webhooks'

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

function ServiceCard({ service, values, onChange, onTest, envManaged = false, keyHint = false }) {
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

  return (
    <div className="service-card card">
      <div className="service-header">
        <span className="service-icon"><Icon name={service.icon} /></span>
        <div>
          <div className="font-semibold">{service.name}</div>
          <div className="text-sm text-muted">{service.description}</div>
        </div>
        {testResult && (
          <div className={`test-badge ${testResult.success ? 'badge-muted' : 'badge-danger'} badge ml-auto`}>
            {testResult.success
              ? <><Icon name="check" /> Connected{testResult.version ? ` v${testResult.version}` : ""}</>
              : 'Failed'}
          </div>
        )}
      </div>

      {envManaged && (
        <p id={noteId} className="text-sm text-muted">
          Set in the Docker configuration (ARRVIEW_{service.id.toUpperCase()}_* environment variables).
          To change it, edit your compose file, .env or secret file and recreate the container
          with <code>docker compose up -d</code>. No image rebuild is needed.
        </p>
      )}

      <div className="service-fields">
        <div className="field-group">
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
        <div className="field-group">
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
              className="btn btn-secondary btn-sm"
              disabled={!hasCredentials || testing}
              onClick={handleTest}
            >
              {testing ? <span className="spinner" style={{width:14,height:14}} /> : 'Test'}
            </button>
          </div>
        </div>
      </div>

      {keyHint && !envManaged && (
        <div id={hintId} className="text-sm text-muted">Re-enter the API key for the new address.</div>
      )}

      {testResult && !testResult.success && (
        <div className="error-banner mt-2" style={{fontSize: 12}}>
          {testResult.error}
        </div>
      )}
    </div>
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
  const [keyHints, setKeyHints] = useState({})
  // Set when an address edit cleared a masked key; only cleared once a key is present at Save time.
  const [keyRequired, setKeyRequired] = useState({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [version, setVersion] = useState(null)
  const [bonjour, setBonjour] = useState(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/arrview/identify')
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
      const r = await fetch(`/api/test/${serviceId}`, {
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
      const r = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cleanConfig),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok || !data.success) throw new Error(data.error || 'Save failed')
      const saved = await fetch('/api/config', { cache: 'no-store' })
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

        {layout && onLayoutChange && <fieldset className="layout-choice">
          <legend>Layout</legend>
          {[['modern', 'Modern'], ['classic', 'Classic']].map(([value, label]) => <label key={value}>
            <input type="radio" name="layout" value={value} checked={layout === value} onChange={() => onLayoutChange(value)} /> {label}
          </label>)}
        </fieldset>}

        <DiscoveryNotice bonjour={bonjour} />

        <section className="card" aria-label="Service checklist"><h2>Services</h2>
          <p className="text-muted">Configured connections (use Test below to verify connectivity).</p>
          <ul>{SERVICES.map(service => <li key={service.id}>{service.name}: {config[service.id].url && hasUsableKey(config[service.id].apikey) ? <><Icon name="check" /> Configured</> : 'Not configured'}</li>)}</ul>
        </section>
        <div className="services-grid">
          {SERVICES.map(service => (
            <ServiceCard
              key={service.id}
              service={service}
              values={config[service.id]}
              onChange={handleChange}
              onTest={handleTest}
              envManaged={Boolean(envManaged[service.id])}
              keyHint={Boolean(keyHints[service.id])}
            />
          ))}
        </div>

        <WebhookSettings address={webhookAddress} onAddressChange={setWebhookAddress}
          sonarr={savedService('sonarr')} radarr={savedService('radarr')} />

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
