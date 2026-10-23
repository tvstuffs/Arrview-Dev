import { useEffect, useRef, useState } from 'react'
import { normalizeAddress, webhookUrl } from '../webhooks'
import { copyText } from '../clipboard'
import { isLocalHostname } from '../hostname'

// Trigger names are the labels of current Sonarr and Radarr; the first two are On Download and On Upgrade in older
// versions. Only triggers that change what ArrView shows are listed: health and update events carry no library
// change, so ArrView would refresh for nothing.
const SERVICES = {
  sonarr: {
    name: 'Sonarr',
    triggers: ['On File Import', 'On File Upgrade', 'On Rename', 'On Series Add', 'On Series Delete', 'On Episode File Delete'],
    sample: '{"eventType":"Download","series":{"title":"ArrView test"}}',
    logLine: '[Sonarr webhook] Download — series: ArrView test',
  },
  radarr: {
    name: 'Radarr',
    triggers: ['On File Import', 'On File Upgrade', 'On Rename', 'On Movie Added', 'On Movie Delete', 'On Movie File Delete'],
    sample: '{"eventType":"Download","movie":{"title":"ArrView test"}}',
    logLine: '[Radarr webhook] Download — movie: ArrView test',
  },
}

function SetupSteps({ service, url }) {
  const { name, triggers } = SERVICES[service]
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
      <li>Select <strong>Test</strong>. A green check means ArrView answered. ArrView ignores the test message itself, so this checks the address only, not the triggers.</li>
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
        <strong>Test passes but nothing updates.</strong> ArrView ignores the test message, so check the triggers. Each real event adds a line
        such as <code>{logLine}</code> to ArrView's log (for Docker: <code>docker logs arrview</code>). No line means the event never arrived.
      </li>
      <li>
        <strong>Check ArrView on its own.</strong> From any computer that can reach ArrView, run this. ArrView logs one line and the pages
        you have open refresh, with no {names} involved.
        <pre>{`curl -X POST -H "Content-Type: application/json" -d '${sample}' "${url}"`}</pre>
      </li>
      <li><strong>Who can send events.</strong> ArrView does not check who calls a webhook, so anyone who can reach this address can make ArrView refresh. Keep ArrView off the public internet unless something in front of it asks for a login.</li>
      <li><strong>Where it applies.</strong> The iOS app uses webhooks in ArrView Server mode only; Connect Directly mode refreshes on a timer.</li>
    </ul>
  </details>
}

// Settings card for the webhooks that Sonarr and Radarr send to ArrView. `address` is the editable address
// those two use to reach ArrView; empty means this page's own address. `sonarr` and `radarr` say which of the
// two are set up, and the card shows nothing when neither is.
export default function WebhookSettings({ address, onAddressChange, sonarr, radarr, location = window.location }) {
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

    {services.map(service => <SetupSteps key={service} service={service} url={webhookUrl(base, service)} />)}
    <Troubleshooting services={services} url={webhookUrl(base, services[0])} />
  </section>
}
