import { useState, useRef, useEffect } from 'react'
import Icon from '../Icon.jsx'
import ConfigPage from '../ConfigPage.jsx'
import NzbSearchModal from '../NzbSearchModal.jsx'
import { SheetClassContext } from '../Sheet.jsx'
import { LibraryProvider } from './LibraryProvider.jsx'
import ServiceBanner from './ServiceBanner.jsx'
import PageHeader, { SettingsLink } from './PageHeader.jsx'
import ShowsPage from './ShowsPage.jsx'
import ShowPage from './ShowPage.jsx'
import MoviesPage from './MoviesPage.jsx'
import MoviePage from './MoviePage.jsx'
import UpcomingPage from './UpcomingPage.jsx'
import DownloadsPage from './DownloadsPage.jsx'
import DownloadPill from './DownloadPill.jsx'
import { DownloadsProvider } from '../../hooks/useDownloads.jsx'
import { usePreference, oneOf } from '../../hooks/usePreference'
import { usePhone } from '../../hooks/usePhone'
import { useHashRoute } from '../../hooks/useHashRoute'
import { useServiceStatus, SERVICE_LABELS } from '../../hooks/useServiceStatus'
import { TABS, availableTabs } from '../../sections'
import './modern.css'

const NAV_TABS = TABS.filter(tab => tab.id !== 'settings')
// Which services a page depends on (in strip order). Only configured, offline services show a strip.
const PAGE_SERVICES = {
  downloads: ['sabnzbd', 'nzbhydra'], shows: ['sonarr'], upcoming: ['sonarr', 'radarr'], movies: ['radarr'],
  search: ['nzbhydra', 'sabnzbd'], settings: [],
}

export default function ModernShell({ config, onConfigSaved, layout, onLayoutChange }) {
  const [savedTab, setSavedTab] = usePreference('tab', 'downloads', oneOf(TABS.map(tab => tab.id)))
  const tabs = availableTabs(config)
  const phone = usePhone()
  const { route, navigate, replace } = useHashRoute()
  const { status, check } = useServiceStatus(config)
  const [toasts, setToasts] = useState([])
  const available = route.valid && tabs.some(tab => tab.id === route.section)
  const lastSection = useRef(savedTab !== 'settings' && tabs.some(tab => tab.id === savedTab) ? savedTab : tabs[0].id)
  const previousPath = useRef(null)

  function addToast(message, type = 'info') {
    const id = `${Date.now()}-${Math.random()}`
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 5000)
  }

  // Empty or unknown hash -> the remembered section; unavailable section -> the first available one. No history entry.
  useEffect(() => {
    if (available) return
    const fallback = route.valid ? tabs[0].id : (tabs.some(tab => tab.id === savedTab) ? savedTab : tabs[0].id)
    replace(`/${fallback}`)
  }, [available, route.valid, route.path])
  // Detail routes record their parent section so Classic and the next visit open there.
  useEffect(() => {
    if (!available) return
    setSavedTab(route.section)
    if (route.section !== 'settings') lastSection.current = route.section
  }, [available, route.section])
  // A new path scrolls to the top and moves focus to the page heading. A loading placeholder heading
  // (data-m-placeholder) is replaced once the library arrives, so focus follows to the real <h1>.
  useEffect(() => {
    if (!available) return
    const previous = previousPath.current
    previousPath.current = route.path
    if (previous === null || previous === route.path) return
    window.scrollTo(0, 0)
    const focusHeading = () => {
      const heading = document.querySelector('.m-main h1')
      if (!heading) return false
      heading.setAttribute('tabindex', '-1'); heading.focus({ preventScroll: true })
      return !heading.hasAttribute('data-m-placeholder')
    }
    const main = document.querySelector('.m-main')
    if (focusHeading() || !main) return
    const observer = new MutationObserver(() => {
      const active = document.activeElement
      if (active && active !== document.body && !active.hasAttribute('data-m-placeholder')) { observer.disconnect(); return }
      if (focusHeading()) observer.disconnect()
    })
    observer.observe(main, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [available, route.path])

  if (!available) return <div className="m-shell" />

  const { section, id } = route
  const hero = id !== null && (section === 'shows' || section === 'movies')
  const offline = PAGE_SERVICES[section].filter(svc => config[svc]?.url && config[svc]?.apikey && status[svc] === 'offline')
    .map(svc => ({ id: svc, label: SERVICE_LABELS[svc] }))
  const navTabs = NAV_TABS.filter(tab => tabs.some(t => t.id === tab.id))
  const settingsBack = () => navigate(`/${lastSection.current}`)
  const common = { phone, onToast: addToast, config }

  let page = null
  if (section === 'downloads') page = <DownloadsPage config={config} phone={phone} onToast={addToast} canSearch={Boolean(config.nzbhydra)} />
  else if (section === 'upcoming') page = <UpcomingPage config={config} phone={phone} />
  else if (section === 'search') page = <>
    <PageHeader title="Search" phone={phone} gear />
    <NzbSearchModal embedded onToast={addToast} canDownload={Boolean(config.sabnzbd)} />
  </>
  else if (section === 'settings') page = <>
    <h1 className="m-title">Settings</h1>
    <ConfigPage initialConfig={config} hideHeader onBack={settingsBack} layout={layout} onLayoutChange={onLayoutChange}
      onSave={next => { onConfigSaved(next); settingsBack() }} />
  </>
  else if (section === 'shows') page = id === null ? <ShowsPage {...common} /> : <ShowPage key={id} id={id} {...common} />
  else if (section === 'movies') page = id === null ? <MoviesPage {...common} /> : <MoviePage key={id} id={id} {...common} />

  const link = tab => <a key={tab.id} className={`m-navlink${section === tab.id ? ' is-active' : ''}`} href={`#/${tab.id}`}
    aria-current={section === tab.id ? 'page' : undefined}>
    {phone && <Icon name={tab.icon} weight={section === tab.id ? 'fill' : 'regular'} />}<span>{tab.label}</span>
  </a>

  return <SheetClassContext.Provider value="m-sheet"><LibraryProvider><DownloadsProvider config={config}><div className={`m-shell${phone ? ' is-phone' : ''}`}>
    {!phone && <header className={`m-topbar${hero && !offline.length ? ' is-overlay' : ''}`}>
      <a className="m-brand" href="#/downloads"><img src="/arrview-icon.svg" alt="" width="28" height="28" /><span>ArrView</span></a>
      <nav className="m-topnav" aria-label="Main navigation">{navTabs.map(link)}</nav>
      <DownloadPill />
      <SettingsLink />
    </header>}
    <ServiceBanner services={offline} onRetry={check} />
    <main className={`m-main${hero ? ' is-hero' : ''}${!phone && hero && !offline.length ? ' is-under-bar' : ''}`}>{page}</main>
    {phone && <nav className="m-bottomnav" aria-label="Main navigation">{navTabs.map(link)}</nav>}
    <div className="toast-container" aria-live="polite" aria-atomic="false">
      {toasts.map(t => <div key={t.id} className={`toast toast-${t.type}`}>{t.message}</div>)}
    </div>
  </div></DownloadsProvider></LibraryProvider></SheetClassContext.Provider>
}
