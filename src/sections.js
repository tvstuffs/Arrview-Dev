// Dashboard sections shared by the Classic and Modern shells.
// `service` needs that one service; `services` is any-of.
export const TABS = [
  { id: 'downloads', label: 'Downloads', icon: 'tray-arrow-down', service: 'sabnzbd' },
  { id: 'shows', label: 'Shows', icon: 'television-simple', service: 'sonarr' },
  { id: 'upcoming', label: 'Upcoming', icon: 'calendar-dots', services: ['sonarr', 'radarr'] },
  { id: 'movies', label: 'Movies', icon: 'film-slate', service: 'radarr' },
  { id: 'search', label: 'Search', icon: 'magnifying-glass', service: 'nzbhydra' },
  { id: 'settings', label: 'Settings', icon: 'gear-six' },
]
export const LAYOUTS = ['modern', 'classic']
const configured = (config, service) => Boolean(config[service]?.url && config[service]?.apikey)
export const availableTabs = config => TABS.filter(tab =>
  tab.services ? tab.services.some(service => configured(config, service)) : !tab.service || configured(config, tab.service))
