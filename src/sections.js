// Dashboard sections shared by the Classic and Modern shells.
export const TABS = [
  { id: 'downloads', label: 'Downloads', icon: 'tray-arrow-down', service: 'sabnzbd' },
  { id: 'shows', label: 'Shows', icon: 'television-simple', service: 'sonarr' },
  { id: 'upcoming', label: 'Upcoming', icon: 'calendar-dots', service: 'sonarr' },
  { id: 'movies', label: 'Movies', icon: 'film-slate', service: 'radarr' },
  { id: 'search', label: 'Search', icon: 'magnifying-glass', service: 'nzbhydra' },
  { id: 'settings', label: 'Settings', icon: 'gear-six' },
]
export const LAYOUTS = ['modern', 'classic']
export const availableTabs = config => TABS.filter(tab => !tab.service || (config[tab.service]?.url && config[tab.service]?.apikey))
