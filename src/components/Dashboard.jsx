import { useState, useCallback, useRef } from 'react'
import DownloadsTab from './DownloadsTab.jsx'
import ShowsTab from './ShowsTab.jsx'
import MoviesTab from './MoviesTab.jsx'
import ConfigPage from './ConfigPage.jsx'
import NzbSearchModal from './NzbSearchModal.jsx'
import { usePreference, oneOf } from '../hooks/usePreference'
import { ServerEventsProvider, useVisiblePolling } from '../hooks/lifecycle'
import './Dashboard.css'

const TABS = [
  { id: 'downloads', label: 'Downloads', icon: '📥', service: 'sabnzbd' },
  { id: 'shows', label: 'Shows', icon: '📺', service: 'sonarr' },
  { id: 'movies', label: 'Movies', icon: '🎬', service: 'radarr' },
  { id: 'search', label: 'Search', icon: '🔎', service: 'nzbhydra' },
  { id: 'settings', label: 'Settings', icon: '⚙️' },
]
const labels = { sabnzbd: 'SABnzbd', nzbhydra: 'NZBHydra', sonarr: 'Sonarr', radarr: 'Radarr' }

export default function Dashboard(props) {
  return <ServerEventsProvider><DashboardContent {...props} /></ServerEventsProvider>
}
function DashboardContent({ config, onConfigSaved }) {
  const [savedTab, setActiveTab] = usePreference('tab', 'downloads', oneOf(TABS.map(tab => tab.id)))
  const tabs = TABS.filter(tab => !tab.service || (config[tab.service]?.url && config[tab.service]?.apikey))
  const activeTab = tabs.some(tab => tab.id === savedTab) ? savedTab : tabs[0].id
  const previousTab = useRef(activeTab === 'settings' ? tabs[0].id : activeTab)
  const [serviceStatus, setServiceStatus] = useState({})
  const [toasts, setToasts] = useState([])
  function navigate(tab) { if (activeTab !== 'settings') previousTab.current = activeTab; setActiveTab(tab) }
  function addToast(message, type = 'info') {
    const id = `${Date.now()}-${Math.random()}`
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 5000)
  }
  const checkServices = useCallback(async () => {
    const checks = {}
    await Promise.allSettled(Object.keys(labels).filter(svc => config[svc]?.url && config[svc]?.apikey).map(async svc => {
      try { checks[svc] = (await fetch(`/api/${svc}/ping`)).ok ? 'online' : 'offline' }
      catch { checks[svc] = 'offline' }
    }))
    setServiceStatus(checks)
  }, [config])
  useVisiblePolling(checkServices, 60000, true, config)
  function returnFromSettings() { setActiveTab(previousTab.current === 'settings' ? tabs[0].id : previousTab.current) }

  return <div className="dashboard">
    <header className="topbar">
      <div className="topbar-left">
        <img className="topbar-logo" src="/arrview-icon.svg" alt="" width="28" height="28" />
        <span className="topbar-title">ArrView</span>
      </div>
      <div className="topbar-services" aria-label="Service status">
        {Object.keys(labels).filter(svc => config[svc]?.url && config[svc]?.apikey).map(svc => {
          const status = serviceStatus[svc] || 'unknown'
          return <div className="service-status" key={svc}>
            <a className="service-pill" href={config[svc].url} target="_blank" rel="noopener noreferrer"
              aria-label={`${labels[svc]}: ${status} — open service`}>
              <span className={`status-dot ${status}`} /><span className="service-pill-name">{labels[svc]}</span>
            </a>
            <span className={`mobile-status status-dot ${status}`} role="img" aria-label={`${labels[svc]}: ${status}`} />
          </div>
        })}
      </div>
      <button className="btn btn-ghost topbar-settings" onClick={() => navigate('settings')} aria-label="Open settings">⚙️</button>
    </header>
    <nav className="tabbar" aria-label="Main navigation">
      {tabs.map(tab => <button key={tab.id} className={`tab-btn ${activeTab === tab.id ? 'active' : ''}`}
        aria-label={tab.label} aria-current={activeTab === tab.id ? 'page' : undefined} onClick={() => navigate(tab.id)}>
        <span className="tab-icon" aria-hidden="true">{tab.icon}</span><span>{tab.label}</span>
      </button>)}
    </nav>
    <main className="dashboard-content">
      {activeTab === 'settings' && <ConfigPage initialConfig={config} onBack={returnFromSettings}
        onSave={next => { onConfigSaved(next); returnFromSettings() }} />}
      {activeTab === 'downloads' && <DownloadsTab onToast={addToast} canSearch={Boolean(config.nzbhydra)} />}
      {activeTab === 'shows' && <ShowsTab onToast={addToast} sonarrUrl={config.sonarr?.url} nzbhydraUrl={config.nzbhydra?.url} />}
      {activeTab === 'movies' && <MoviesTab onToast={addToast} />}
      {activeTab === 'search' && <NzbSearchModal embedded onToast={addToast} canDownload={Boolean(config.sabnzbd)} />}
    </main>
    <div className="toast-container" aria-live="polite" aria-atomic="false">
      {toasts.map(t => <div key={t.id} className={`toast toast-${t.type}`}>{t.message}</div>)}
    </div>
  </div>
}
