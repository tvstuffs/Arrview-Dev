import { useState, useRef, useEffect } from 'react'
import Icon from './Icon.jsx'
import UpcomingTab from './UpcomingTab'
import DownloadsTab from './DownloadsTab.jsx'
import ShowsTab from './ShowsTab.jsx'
import MoviesTab from './MoviesTab.jsx'
import ConfigPage from './ConfigPage.jsx'
import NzbSearchModal from './NzbSearchModal.jsx'
import ModernShell from './modern/ModernShell.jsx'
import { usePreference, oneOf } from '../hooks/usePreference'
import { ServerEventsProvider } from '../hooks/lifecycle'
import { usePhone } from '../hooks/usePhone'
import { useServiceStatus, SERVICE_LABELS as labels } from '../hooks/useServiceStatus'
import { TABS, LAYOUTS, availableTabs } from '../sections'
import './Dashboard.css'

// The `layout` preference picks the shell; the shared `tab` preference records the current section.
export default function Dashboard(props) {
  const [layout, setLayout] = usePreference('layout', 'modern', oneOf(LAYOUTS))
  const Shell = layout === 'classic' ? ClassicShell : ModernShell
  return <ServerEventsProvider><Shell key={layout} {...props} layout={layout} onLayoutChange={setLayout} /></ServerEventsProvider>
}

function ClassicShell({ config, onConfigSaved, layout, onLayoutChange }) {
  const [savedTab, setActiveTab] = usePreference('tab', 'downloads', oneOf(TABS.map(tab => tab.id)))
  const tabs = availableTabs(config)
  const activeTab = tabs.some(tab => tab.id === savedTab) ? savedTab : tabs[0].id
  const previousTab = useRef(activeTab === 'settings' ? tabs[0].id : activeTab)
  const [selectedShow, setSelectedShow] = useState(null)
  const [toasts, setToasts] = useState([])
  const phone = usePhone()
  const { status: serviceStatus } = useServiceStatus(config)
  const navTabs = phone ? tabs.filter(tab => tab.id !== 'settings') : tabs
  // Classic ignores hash routes: drop a stale Modern URL so a reload does not re-enter it.
  useEffect(() => { if (window.location.hash) window.history.replaceState(null, '', window.location.pathname + window.location.search) }, [])
  function navigate(tab) { if (activeTab !== 'settings') previousTab.current = activeTab; setActiveTab(tab) }
  function addToast(message, type = 'info') {
    const id = `${Date.now()}-${Math.random()}`
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 5000)
  }
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
      {phone && <button className="btn btn-ghost topbar-settings" onClick={() => navigate('settings')} aria-label="Open settings"><Icon name="gear-six" weight={activeTab === 'settings' ? 'fill' : 'regular'} /></button>}
    </header>
    <nav className="tabbar" aria-label="Main navigation">
      {navTabs.map(tab => <button key={tab.id} className={`tab-btn tab-${tab.id} ${activeTab === tab.id ? 'active' : ''}`}
        aria-label={tab.label} aria-current={activeTab === tab.id ? 'page' : undefined} onClick={() => navigate(tab.id)}>
        <span className="tab-icon" aria-hidden="true"><Icon name={tab.icon} weight={activeTab === tab.id ? 'fill' : 'regular'} /></span><span>{tab.label}</span>
      </button>)}
    </nav>
    <main className="dashboard-content">
      {activeTab === 'settings' && <ConfigPage initialConfig={config} onBack={returnFromSettings}
        layout={layout} onLayoutChange={onLayoutChange}
        onSave={next => { onConfigSaved(next); returnFromSettings() }} />}
      {activeTab === 'downloads' && <DownloadsTab onToast={addToast} canSearch={Boolean(config.nzbhydra)} />}
      {activeTab === 'upcoming' && <UpcomingTab config={config} onShow={id => { setSelectedShow(id); navigate('shows') }} onMovie={() => navigate('movies')} />}
      {activeTab === 'shows' && <ShowsTab selectedShow={selectedShow} onSelected={() => setSelectedShow(null)} onUpcoming={() => navigate('upcoming')} onToast={addToast} sonarrUrl={config.sonarr?.url} nzbhydraUrl={config.nzbhydra?.url} />}
      {activeTab === 'movies' && <MoviesTab onToast={addToast} />}
      {activeTab === 'search' && <NzbSearchModal embedded onToast={addToast} canDownload={Boolean(config.sabnzbd)} />}
    </main>
    <div className="toast-container" aria-live="polite" aria-atomic="false">
      {toasts.map(t => <div key={t.id} className={`toast toast-${t.type}`}>{t.message}</div>)}
    </div>
  </div>
}
