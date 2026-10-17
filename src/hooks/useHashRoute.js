import { useState, useEffect, useCallback } from 'react'

const SECTIONS = ['downloads', 'shows', 'upcoming', 'movies', 'search', 'settings']
const WITH_ID = ['shows', 'movies']

// `#/shows/12` -> { section: 'shows', id: '12', path: '/shows/12', valid: true }. Anything else is invalid.
export function parseHash(hash) {
  const parts = String(hash || '').replace(/^#\/?/, '').replace(/\/$/, '').split('/')
  const [section, id, ...rest] = parts
  const valid = SECTIONS.includes(section) && rest.length === 0 && (id === undefined || (WITH_ID.includes(section) && id !== ''))
  return valid ? { section, id: id ?? null, path: `/${section}${id === undefined ? '' : `/${id}`}`, valid } : { section: null, id: null, path: null, valid: false }
}

// Hash routes for the Modern shell. `navigate` adds a history entry; `replace` does not.
export function useHashRoute() {
  const [hash, setHash] = useState(() => window.location.hash)
  useEffect(() => {
    const update = () => setHash(window.location.hash)
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])
  const navigate = useCallback(path => { window.location.hash = path }, [])
  const replace = useCallback(path => {
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${path}`)
    setHash(`#${path}`)
  }, [])
  return { route: parseHash(hash), navigate, replace }
}
