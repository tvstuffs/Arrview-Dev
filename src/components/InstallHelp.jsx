import { useState } from 'react'
import { installPlatform, requestInstall, useInstallStatus } from '../install'
import './InstallHelp.css'

export default function InstallHelp() {
  const { installed, canInstall } = useInstallStatus()
  const [message, setMessage] = useState('')
  const platform = installPlatform()
  const secure = window.isSecureContext

  async function install() {
    try {
      const result = await requestInstall()
      setMessage(result === 'accepted' ? 'Installation requested. Look for ArrView on your Home Screen.' :
        'You can still add ArrView using your browser menu.')
    } catch {
      setMessage('Installation could not open. Use your browser menu to add ArrView instead.')
    }
  }

  return (
    <section className="install-help card" aria-labelledby="install-title">
      <h2 id="install-title">{installed ? 'Home Screen app' : 'Add to Home Screen'}</h2>
      {installed ? <p>ArrView is running as an app.</p> : platform === 'ios' ? (
        <p>In Safari, tap Share → Add to Home Screen → Add. Keep “Open as Web App” enabled if offered.</p>
      ) : platform === 'android' ? (
        <p>{secure ? 'In Chrome, open the ⋮ menu → Install app (or Add to Home screen) → Install.' :
          'In Chrome, open the ⋮ menu → Add to Home screen. On this HTTP connection, this creates a shortcut that opens in Chrome, not a standalone app. Use an HTTPS address for full installation.'}</p>
      ) : <p>Use your browser’s Install app button or menu. On iPhone use Safari’s Share → Add to Home Screen; on Android use Chrome’s menu.</p>}
      {!installed && canInstall && <button className="btn btn-primary" onClick={install}>Install ArrView</button>}
      {message && <p role="status">{message}</p>}
      {!secure && <p className="text-secondary">Offline startup is unavailable on this HTTP address. HTTPS enables the offline screen; it does not make your media available offline.</p>}
      {installed && <p className="text-secondary">Links to Sonarr, Radarr and other services may open your browser. Return to ArrView using its Home Screen icon. If the app restarts, it returns to the default tab.</p>}
    </section>
  )
}
