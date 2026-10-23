import Icon from './Icon.jsx'
import { isLocalHostname } from '../hostname'

const REASONS = {
  'port-in-use': 'Another program on this host is using the mDNS port (UDP 5353) and does not share it. NAS systems that run their own network discovery service often do this.',
  'permission-denied': 'This server is not allowed to open the mDNS port (UDP 5353).',
  'not-installed': 'The Bonjour component is not installed in this server.',
}
const FALLBACK = 'Bonjour failed to start. The server log has the details.'

// Settings notice for a server that could not start Bonjour, which the iOS app uses to find it.
// `bonjour` is the object GET /api/arrview/identify returns; only "unavailable" is a problem, so
// off, starting and advertising (and an older server that sends nothing) show nothing.
export default function DiscoveryNotice({ bonjour, location = window.location }) {
  if (bonjour?.state !== 'unavailable') return null
  // Opened on the server itself, the address bar says nothing a phone could use.
  const remote = !isLocalHostname(location.hostname)
  return <section className="discovery-notice" role="status" aria-label="iOS auto-discovery">
    <Icon name="warning" />
    <div>
      <p className="font-semibold">iOS auto-discovery (Bonjour) is unavailable</p>
      <p>{REASONS[bonjour.reason] || FALLBACK}</p>
      <p>
        ArrView works normally. In the iOS app, use "Or enter the address manually" and enter this server's address
        {remote && <>: <code>{location.origin}</code></>}.
      </p>
    </div>
  </section>
}
