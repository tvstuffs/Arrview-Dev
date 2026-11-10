import { useCallback, useEffect, useRef, useState } from 'react'
import { WEBHOOK_TRIGGERS, describeActivity, normalizeAddress, readSetupStatus, webhookUrl } from '../webhooks'
import { apiFetch } from '../api'
import { copyText } from '../clipboard'
import { isLocalHostname } from '../hostname'

// The trigger labels (WEBHOOK_TRIGGERS) are those of current Sonarr and Radarr; the first two are On Download and
// On Upgrade in older versions.
const SERVICES = {
  sonarr: {
    name: 'Sonarr',
    sample: '{"eventType":"Download","series":{"title":"ArrView test"}}',
    logLine: '[Sonarr webhook] Download — series: ArrView test',
  },
  radarr: {
    name: 'Radarr',
    sample: '{"eventType":"Download","movie":{"title":"ArrView test"}}',
    logLine: '[Radarr webhook] Download — movie: ArrView test',
  },
}
// Sonarr and Radarr share the API the status is read through, so a row can hold the address of the other one.
const OTHER_APP = { sonarr: 'radarr', radarr: 'sonarr' }
const triggerLabels = service => WEBHOOK_TRIGGERS[service].map(trigger => trigger.label)
const LOADING = { status: 'loading', data: null, receivedAt: 0 }
// How long a set-up or remove runs before the card says why it can take long: the app tests the address first,
// and gives up on an address that never answers only after about 100 seconds.
export const WAIT_NOTICE_MS = 3000

// The status line for one service, from GET /api/webhook-setup/:service. `status` is null while it loads and
// 'unknown' when the answer was not one. `other` is the name of the other app, for a row that holds its address.
function statusText(name, status, other) {
  if (status === null) return `Checking ${name}…`
  if (status === 'unknown') return 'Cannot check the webhook status.'
  switch (status.state) {
    case 'present': return 'Set up.'
    case 'absent': return 'Not set up.'
    case 'different-address': return `Set up, but at a different address: ${status.address || 'unknown'}.`
      + (status.extra ? ' Its URL also carries login details or a query.' : '')
      + ` Fix it in ${name} under Settings, Connect, or remove it here and set up again.`
    case 'needs-address': return 'Save the ArrView address above first.'
    case 'not-configured': return `Cannot check: ${name} is not set up in ArrView.`
    case 'unreachable': return `Cannot check: ${name} could not be reached.`
    case 'key-rejected': return `Cannot check: ${name} rejected the API key.`
    case 'wrong-app': return `Cannot check: the address saved for ${name} is ${other}, not ${name}. Fix ${name}'s address under Services.`
    case 'name-taken': return `Cannot set up: a connection named ArrView already exists in ${name}. Rename or remove it there.`
    case 'multiple': return `Several ArrView webhooks exist in ${name}. Remove the extra ones there.`
    default: return 'Cannot check the webhook status.'
  }
}

// What the last set-up or remove said, under the status line.
function outcomeText(name, outcome) {
  if (outcome.kind === 'no-answer') return [`ArrView did not answer in time. ${name} may still be testing the address: the status above is re-checked.`]
  if (outcome.kind === 'error') return [outcome.text]
  const lines = [outcome.testReceived ? `ArrView received ${name}'s test message.`
    : `${name} saved the webhook, but ArrView did not receive its test message. ${name} counts any answer below 400 as a pass, so a login page or a redirect at that address can pass its test. Check that the address reaches this ArrView, then check "Last event received" below.`]
  if (outcome.skipped.length) lines.push(`This version of ${name} does not offer: ${outcome.skipped.join(', ')}.`)
  return lines
}

// Whether ArrView's webhook is in Sonarr or Radarr, with Set up (a preview first) and Remove (a confirmation first).
// The server does the work with the saved address and the stored key; this only ever gets a state back.
function SetupStatus({ service, savedAddress, unsaved }) {
  const { name } = SERVICES[service]
  const [status, setStatus] = useState(null)
  const [step, setStep] = useState(null)
  const [pending, setPending] = useState(false)
  const [waiting, setWaiting] = useState(false)
  const [outcome, setOutcome] = useState(null)
  const latest = useRef(0)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  const check = useCallback(async () => {
    const mine = ++latest.current
    let next = 'unknown'
    try {
      const r = await apiFetch(`/api/webhook-setup/${service}`, { cache: 'no-store' })
      if (r.ok) next = readSetupStatus(await r.json()) || 'unknown'
    } catch { /* stays unknown */ }
    if (alive.current && mine === latest.current) setStatus(next)
  }, [service])
  // On mount, and again when a saved address changes what the server compares with.
  useEffect(() => { check() }, [check, savedAddress])

  async function run(method) {
    setPending(true)
    setOutcome(null)
    const timer = setTimeout(() => { if (alive.current) setWaiting(true) }, WAIT_NOTICE_MS)
    let next = null
    try {
      const r = method === 'POST'
        ? await apiFetch(`/api/webhook-setup/${service}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
        : await apiFetch(`/api/webhook-setup/${service}`, { method: 'DELETE' })
      let body = null
      try { body = await r.json() } catch { /* not JSON */ }
      if (!body || typeof body !== 'object' || Array.isArray(body)) next = { kind: 'no-answer' }
      else if (!r.ok) next = { kind: 'error', text: typeof body.error === 'string' && body.error ? body.error : `${name} did not answer as expected.` }
      else if (body.created === true) {
        next = { kind: 'created', testReceived: body.testReceived === true,
          skipped: Array.isArray(body.skipped) ? body.skipped.filter(label => typeof label === 'string') : [] }
      }
    } catch {
      next = { kind: 'no-answer' }
    }
    clearTimeout(timer)
    if (!alive.current) return
    setWaiting(false)
    setOutcome(next)
    await check()
    if (!alive.current) return
    setStep(null)
    setPending(false)
  }

  const state = status && status !== 'unknown' ? status.state : null
  const canSetUp = state === 'absent'
  const canRemove = state === 'present' || state === 'different-address'
  const titleId = `webhook-setup-${service}-title`
  const hintId = `webhook-setup-${service}-hint`
  return <div className="webhook-setup" aria-labelledby={titleId} role="group">
    <h3 id={titleId}>Status in {name}</h3>
    <div aria-live="polite" className="webhook-setup-live">
      <p className="text-sm">{statusText(name, status, SERVICES[OTHER_APP[service]].name)}</p>
      {outcome && outcomeText(name, outcome).map(text => <p key={text} className={`text-sm${outcome.kind === 'created' && outcome.testReceived ? '' : ' text-warning'}`}>{text}</p>)}
      {waiting && <p className="text-sm text-muted">Waiting for {name} to test the address. If {name} cannot reach ArrView, this can take up to two minutes.</p>}
    </div>
    {canSetUp && step !== 'preview' && <div className="webhook-setup-actions">
      <button type="button" className="btn btn-secondary btn-sm" disabled={pending || unsaved}
        aria-describedby={unsaved ? hintId : undefined} onClick={() => { setOutcome(null); setStep('preview') }}>Set up in {name}</button>
      {unsaved && <p id={hintId} className="text-sm text-muted">Save the address first: Set up uses the saved address.</p>}
    </div>}
    {step === 'preview' && <div role="region" aria-label={`Webhook to add in ${name}`} className="webhook-setup-preview">
      <p className="text-sm">ArrView adds this connection in {name}:</p>
      <ul className="text-sm">
        <li>Name: ArrView</li>
        <li>URL: <code>{status?.url || ''}</code></li>
        <li>Method: POST</li>
        <li>Triggers: {triggerLabels(service).join(', ')}</li>
      </ul>
      <p className="text-sm">{name} sends ArrView a test message before saving. If {name} cannot reach the address, nothing is saved.</p>
      <div className="webhook-setup-actions">
        <button type="button" className="btn btn-primary btn-sm" disabled={pending || unsaved} onClick={() => run('POST')}>Add</button>
        <button type="button" className="btn btn-secondary btn-sm" disabled={pending} onClick={() => setStep(null)}>Cancel</button>
      </div>
    </div>}
    {canRemove && step !== 'confirm' && <div className="webhook-setup-actions">
      <button type="button" className="btn btn-secondary btn-sm" disabled={pending}
        onClick={() => { setOutcome(null); setStep('confirm') }}>Remove from {name}</button>
    </div>}
    {step === 'confirm' && <div className="webhook-setup-confirm">
      <p className="text-sm">Remove the ArrView webhook from {name}? Your other connections are not changed.</p>
      <div className="webhook-setup-actions">
        <button type="button" className="btn btn-danger btn-sm" disabled={pending} onClick={() => run('DELETE')}>Remove</button>
        <button type="button" className="btn btn-secondary btn-sm" disabled={pending} onClick={() => setStep(null)}>Cancel</button>
      </div>
    </div>}
  </div>
}

function SetupSteps({ service, url }) {
  const { name } = SERVICES[service]
  const triggers = triggerLabels(service)
  return <details>
    <summary>Set up the webhook in {name}</summary>
    <ol>
      <li>In {name}, open <strong>Settings</strong>, then <strong>Connect</strong>. Select the <strong>+</strong> button (Add Connection) and choose <strong>Webhook</strong>.</li>
      <li>Set <strong>Name</strong> to ArrView.</li>
      <li>
        Under <strong>Notification Triggers</strong>, tick{' '}
        {triggers.map((trigger, i) => <span key={trigger}>{i > 0 && (i === triggers.length - 1 ? ' and ' : ', ')}<strong>{trigger}</strong></span>)}.
        {' '}Leave the others off. Older versions call the first two On Download and On Upgrade.
      </li>
      <li>Set <strong>Webhook URL</strong> to <code>{url}</code> and <strong>Method</strong> to POST. Leave Username, Password and Headers empty: ArrView does not use them.</li>
      <li>
        Select <strong>Test</strong>. A green check only means that something at that address answered: a login page or a redirect also
        passes. The proof that ArrView received it is "Test message received" under Last event received above, within a few seconds.
        ArrView changes no page for it, so this checks the address, not the triggers.
      </li>
      <li>Select <strong>Save</strong>.</li>
    </ol>
  </details>
}

// `services` are the ones that are set up; the example uses the first.
function Troubleshooting({ services, url }) {
  const names = services.map(service => SERVICES[service].name).join(' or ')
  const { sample, logLine } = SERVICES[services[0]]
  return <details>
    <summary>If it does not work</summary>
    <ul>
      <li>
        <strong>Test fails in {names}.</strong> The address cannot be reached from where it runs. Use the IP address of the machine
        that runs ArrView (containers often cannot look up names ending in .local), remember that localhost inside a container is the
        container itself, and check that no firewall blocks the port. The method must be POST. If ArrView is behind an HTTPS proxy whose
        certificate {names} does not trust, enter ArrView's plain http address above instead.
      </li>
      <li>
        <strong>Test passes but nothing updates.</strong> First look under Last event received above. If "Test message received" did not
        appear after the Test, the test reached something other than this ArrView, for example a login page or a redirect from a proxy in
        front of it, or another server at that address. {names} counts any answer below 400 as a pass. Enter an address that reaches
        ArrView directly. If the Test message is listed, check the triggers. Each real event
        is listed under Last event received above and adds a line such as <code>{logLine}</code> to ArrView's log (for Docker:{' '}
        <code>docker logs arrview</code>). If it stays at "No event" while things change in {names}, the events never arrive.
      </li>
      <li>
        <strong>Check ArrView on its own.</strong> From any computer that can reach ArrView, run this. ArrView logs one line, the event is
        listed under Last event received, and the pages you have open refresh, with no {names} involved.
        <pre>{`curl -X POST -H "Content-Type: application/json" -d '${sample}' "${url}"`}</pre>
      </li>
      <li><strong>Who can send events.</strong> ArrView does not check who calls a webhook, so anyone who can reach this address can make ArrView refresh. Keep ArrView off the public internet unless something in front of it asks for a login.</li>
      <li><strong>Where it applies.</strong> The iOS app uses webhooks in ArrView Server mode only; Connect Directly mode refreshes on a timer.</li>
    </ul>
  </details>
}

// What Sonarr and Radarr last delivered, from useWebhookActivity: one line per service.
function LastEvents({ services, activity, now }) {
  const { status, data, receivedAt } = activity
  const elapsed = Math.max(0, Math.floor((now - receivedAt) / 1000))
  return <div className="webhook-activity-block">
    <h3 id="webhook-activity-title">Last event received</h3>
    <p className="text-sm text-muted">
      Updates every few seconds while this page is open. It starts empty when ArrView restarts, and it shows that a message arrived, not who sent it.
    </p>
    {status === 'loading' && <p className="text-sm text-muted">Checking…</p>}
    {status === 'error' && <p className="text-sm text-muted">Could not read what ArrView received. Trying again.</p>}
    {status === 'old' && <p className="text-sm text-muted">This version of ArrView does not report received events.</p>}
    {status === 'ready' && <ul className="webhook-activity" aria-labelledby="webhook-activity-title">
      {services.map(service => <li key={service}>
        <strong>{SERVICES[service].name}</strong>: {describeActivity(data[service], data.uptimeSeconds, elapsed)}
      </li>)}
    </ul>}
  </div>
}

// Settings card for the webhooks that Sonarr and Radarr send to ArrView. `address` is the editable address
// those two use to reach ArrView; empty means this page's own address. `sonarr` and `radarr` say which of the
// two are set up, and the card shows nothing when neither is. `savedAddress` is the address as saved, the one Set up
// writes. `activity` is what they last delivered (useWebhookActivity), and `now` the time the ages are counted to.
export default function WebhookSettings({ address, onAddressChange, savedAddress = '', sonarr, radarr, activity = LOADING, now = Date.now(), location = window.location }) {
  const [message, setMessage] = useState('')
  const timer = useRef(null)
  const fields = useRef({})
  useEffect(() => () => clearTimeout(timer.current), [])

  const services = [sonarr && 'sonarr', radarr && 'radarr'].filter(Boolean)
  if (!services.length) return null

  const typed = address.trim()
  const parsed = normalizeAddress(address)
  const base = parsed || location.origin
  const invalid = Boolean(typed) && !parsed
  const onTheServer = !typed && isLocalHostname(location.hostname)

  async function copy(service, url) {
    const ok = await copyText(url, fields.current[service])
    const { name } = SERVICES[service]
    setMessage(ok ? `${name} webhook URL copied.` : `Could not copy the ${name} webhook URL automatically. It is selected: copy it with your keyboard or menu.`)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setMessage(''), 4000)
  }

  return <section className="webhook-card card" aria-labelledby="webhook-title">
    <h2 id="webhook-title">Webhooks</h2>
    <p className="text-muted">
      Sonarr and Radarr can tell ArrView the moment something changes, so the web pages and the iOS app (in ArrView Server mode)
      update at once instead of at the next timed refresh. This is optional: ArrView works without it.
    </p>

    <div className="field-group">
      <label htmlFor="webhook-address">ArrView address for Sonarr and Radarr</label>
      <input id="webhook-address" type="url" inputMode="url" autoComplete="off" autoCapitalize="none" spellCheck={false}
        placeholder={location.origin} value={address} aria-invalid={invalid || undefined}
        aria-describedby={['webhook-address-help', invalid && 'webhook-address-invalid', onTheServer && 'webhook-address-local'].filter(Boolean).join(' ')}
        onChange={event => onAddressChange(event.target.value)} />
      <p id="webhook-address-help" className="text-sm text-muted">
        The address Sonarr and Radarr use to reach ArrView. It has to work from where they run, which can differ from the address in your
        browser: use the IP address of the machine that runs ArrView and its port (7777 unless you changed it), like <code>{'http://<host>:7777'}</code>.
        Leave it empty to use this page's address. It is saved with the other settings.
      </p>
      {invalid && <p id="webhook-address-invalid" className="text-sm text-warning">
        That is not an address yet. Write it like <code>{'http://<host>:7777'}</code>. The URLs below use this page's address until it is.
      </p>}
      {onTheServer && <p id="webhook-address-local" className="text-sm text-warning">
        This page is open as {location.hostname}. Sonarr and Radarr can use that only if they run on this same machine; otherwise enter ArrView's network address above.
      </p>}
    </div>

    {services.map(service => {
      const url = webhookUrl(base, service)
      const id = `webhook-url-${service}`
      return <div className="field-group" key={service}>
        <label htmlFor={id}>{SERVICES[service].name} webhook URL</label>
        <div className="input-group">
          <input id={id} ref={element => { fields.current[service] = element }} type="url" readOnly value={url}
            onFocus={event => event.target.select()} />
          <button type="button" className="btn btn-secondary btn-sm" aria-label={`Copy ${SERVICES[service].name} webhook URL`}
            onClick={() => copy(service, url)}>Copy</button>
        </div>
      </div>
    })}
    <p role="status" className="text-sm text-muted webhook-status">{message}</p>

    {services.map(service => <SetupStatus key={service} service={service} savedAddress={savedAddress}
      unsaved={address.trim() !== savedAddress.trim()} />)}

    <LastEvents services={services} activity={activity} now={now} />

    {services.map(service => <SetupSteps key={service} service={service} url={webhookUrl(base, service)} />)}
    <Troubleshooting services={services} url={webhookUrl(base, services[0])} />
  </section>
}
