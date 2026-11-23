import Icon from '../Icon.jsx'
import { LiveRing } from './DownloadPill.jsx'
import { useDownloads, useDownloadNeeds } from '../../hooks/useDownloads.jsx'

const SETTINGS = { id: 'settings', label: 'Settings', icon: 'gear-six' }

// The vertical navigation of short screens. "labelled": one group, an icon over a label for each tab, Settings last
// (labels hidden below 520 px of height). "ios" (inside a side-controls column only): two pills, as the system's own apps
// draw them there; the top pill holds Back (detail pages) above Settings, the tab pill the content tabs as icons.
// Either way the Downloads item shows the live ring while something downloads, and its name stays "Downloads".
export default function Rail({ tabs, section, style, iconsOnly, back }) {
  useDownloadNeeds({ sab: true })
  const { pill, configured } = useDownloads()
  const live = configured.sab && pill ? pill.pct : null
  const current = id => (section === id ? 'page' : undefined)
  const glyph = tab => <Icon name={tab.icon} weight={section === tab.id ? 'fill' : 'regular'} />
  const ring = (tab, size) => tab.id === 'downloads' && live !== null && <LiveRing pct={live} size={size} />
  if (style === 'ios') {
    const item = tab => <a key={tab.id} className={`m-pilltab${section === tab.id ? ' is-active' : ''}`} href={`#/${tab.id}`}
      aria-label={tab.label} title={tab.label} aria-current={current(tab.id)}>
      <span className="m-pilltab-icon">{glyph(tab)}{ring(tab, 36)}</span>
    </a>
    return <div className="m-rail is-ios">
      <div className="m-rail-pill is-top">
        {back && <a className="m-pilltab" href={back.href} aria-label={back.label} title={back.label}><span className="m-pilltab-icon"><Icon name="caret-left" /></span></a>}
        {item(SETTINGS)}
      </div>
      <nav className="m-rail-pill is-tabs" aria-label="Main navigation">{tabs.map(item)}</nav>
    </div>
  }
  return <div className="m-rail is-labelled">
    <nav className="m-rail-nav" aria-label="Main navigation">
      {[...tabs, SETTINGS].map(tab => <a key={tab.id} className={`m-raillink${section === tab.id ? ' is-active' : ''}`} href={`#/${tab.id}`}
        aria-label={tab.label} aria-current={current(tab.id)}>
        <span className="m-rail-icon">{glyph(tab)}{ring(tab, 30)}</span>
        {!iconsOnly && <span className="m-rail-label">{tab.label}</span>}
      </a>)}
    </nav>
  </div>
}
