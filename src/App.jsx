import { useState, useEffect, useCallback } from 'react'
import ConfigPage from './components/ConfigPage.jsx'
import Dashboard from './components/Dashboard.jsx'

export default function App() {
  const [config, setConfig] = useState(null)
  const [loading, setLoading] = useState(true)
  const [unavailable, setUnavailable] = useState(false)

  const loadConfig = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/config', { cache: 'no-store', signal: AbortSignal.timeout(10000) })
      if (!response.ok) throw new Error('Server unavailable')
      setConfig(await response.json())
      setUnavailable(false)
    } catch {
      setUnavailable(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadConfig() }, [loadConfig])

  if (loading) {
    return (
      <div className="loading-screen">
        <span className="spinner" />
        Loading…
      </div>
    )
  }

  if (unavailable) {
    return (
      <main className="loading-screen offline-state">
        <h1>Can’t reach your ArrView server</h1>
        <p>Check your connection and that the server is running, then try again.</p>
        <button className="btn btn-primary btn-lg" onClick={loadConfig}>Try again</button>
      </main>
    )
  }

  const isConfigured =
    config &&
    ((config.sabnzbd?.url && config.sabnzbd?.apikey) ||
     (config.sonarr?.url   && config.sonarr?.apikey)  ||
     (config.radarr?.url   && config.radarr?.apikey) ||
     (config.nzbhydra?.url && config.nzbhydra?.apikey))

  if (!isConfigured) {
    return (
      <ConfigPage
        initialConfig={config}
        onSave={newConfig => setConfig(newConfig)}
      />
    )
  }

  return (
    <Dashboard
      config={config}
      onConfigSaved={setConfig}
    />
  )
}
