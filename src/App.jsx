import { useState, useEffect, useCallback, useMemo } from 'react'
import ConfigPage from './components/ConfigPage.jsx'
import Dashboard from './components/Dashboard.jsx'
import SignIn from './components/SignIn.jsx'
import Setup from './components/Setup.jsx'
import { apiFetch, onAuthRequired, resetAuthRequired } from './api'
import { AuthContext } from './AuthContext'

// Asks the server whether a login is required. A status with no boolean `required` (an older server or a mock) and a
// 404 both mean the login is off; any other failure is "can't reach the server".
async function loadStatus() {
  const response = await apiFetch('/api/auth/status', { cache: 'no-store', signal: AbortSignal.timeout(10000) })
  if (response.status === 404) return { required: false, signedIn: false }
  if (!response.ok) throw new Error('Server unavailable')
  const status = await response.json()
  return typeof status?.required === 'boolean' ? status : { required: false, signedIn: false }
}

export default function App() {
  const [config, setConfig] = useState(null)
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [unavailable, setUnavailable] = useState(false)
  const [needSignIn, setNeedSignIn] = useState(false)
  const [expired, setExpired] = useState(false)
  const [needSetup, setNeedSetup] = useState(false)

  const loadConfig = useCallback(async () => {
    setLoading(true)
    try {
      const current = await loadStatus()
      setStatus(current)
      // A new install: the first-run choice comes before anything else is requested.
      setNeedSetup(current.setupPending === true)
      if (current.setupPending === true) {
        setUnavailable(false)
        return
      }
      if (current.required && !current.signedIn) {
        setNeedSignIn(true)
        setUnavailable(false)
        return
      }
      setNeedSignIn(false)
      const response = await apiFetch('/api/config', { cache: 'no-store', signal: AbortSignal.timeout(10000) })
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

  // A 401 that says the login is required (an expired or revoked session): leave the app for Sign in.
  useEffect(() => onAuthRequired(() => { setExpired(true); setNeedSignIn(true) }), [])

  const refresh = useCallback(async () => {
    try {
      const current = await loadStatus()
      setStatus(current)
      if (current.required && !current.signedIn) { setExpired(false); setNeedSignIn(true) }
    } catch { /* keep the last status */ }
  }, [])

  const authValue = useMemo(() => (status ? { status, refresh } : null), [status, refresh])

  const signedIn = useCallback(() => {
    resetAuthRequired()
    setExpired(false)
    loadConfig()
  }, [loadConfig])

  if (needSignIn) return <SignIn onSignedIn={signedIn} expired={expired} />

  if (needSetup) return <Setup onDone={signedIn} />

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

  return (
    <AuthContext.Provider value={authValue}>
      {!isConfigured ? (
        <ConfigPage
          initialConfig={config}
          onSave={newConfig => setConfig(newConfig)}
        />
      ) : (
        <Dashboard
          config={config}
          onConfigSaved={setConfig}
        />
      )}
    </AuthContext.Provider>
  )
}
