import { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react'
import { checkedFetch } from '../../actions'
import { useVisiblePolling, useServerEvents } from '../../hooks/lifecycle'

const Library = createContext(null)

// One cache of the series list, the movie list and the server identity for the Modern shell.
// Polling runs only while a consumer page is mounted (see useSeries / useMovies).
export function LibraryProvider({ children }) {
  const [state, setState] = useState({ series: null, seriesError: null, movies: null, moviesError: null, identity: null })
  useEffect(() => { checkedFetch('/api/arrview/identify').then(identity => setState(s => ({ ...s, identity }))).catch(() => {}) }, [])
  const fetchSeries = useCallback(async () => {
    try {
      const r = await fetch('/api/sonarr/series')
      if (!r.ok) throw new Error((await r.json()).error)
      const data = await r.json()
      setState(s => ({ ...s, series: Array.isArray(data) ? data : [], seriesError: null }))
    } catch (e) { setState(s => ({ ...s, seriesError: e.message || 'Request failed' })) }
  }, [])
  const fetchMovies = useCallback(async () => {
    try {
      const r = await fetch('/api/radarr/movies')
      if (!r.ok) throw new Error((await r.json()).error)
      const data = await r.json()
      setState(s => ({ ...s, movies: Array.isArray(data) ? data : [], moviesError: null }))
    } catch (e) { setState(s => ({ ...s, moviesError: e.message || 'Request failed' })) }
  }, [])
  const value = useMemo(() => ({ ...state, fetchSeries, fetchMovies }), [state, fetchSeries, fetchMovies])
  return <Library.Provider value={value}>{children}</Library.Provider>
}

export function useSeries() {
  const lib = useContext(Library)
  useVisiblePolling(lib.fetchSeries, 30000)
  useServerEvents('sonarr', lib.fetchSeries)
  return { series: lib.series, error: lib.seriesError, loading: lib.series === null && !lib.seriesError, refresh: lib.fetchSeries }
}

export function useMovies() {
  const lib = useContext(Library)
  useVisiblePolling(lib.fetchMovies, 60000)
  useServerEvents('radarr', lib.fetchMovies)
  return { movies: lib.movies, error: lib.moviesError, loading: lib.movies === null && !lib.moviesError, refresh: lib.fetchMovies, identity: lib.identity }
}
