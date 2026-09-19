import { createContext, useCallback, useContext, useEffect, useRef } from 'react'

const ServerEvents = createContext(null)
export function ServerEventsProvider({ children }) {
  const listeners = useRef(new Set())
  const subscribe = useCallback(listener => {
    listeners.current.add(listener)
    return () => listeners.current.delete(listener)
  }, [])
  useEffect(() => {
    let source
    const notify = (type, data) => listeners.current.forEach(listener => listener(type, data))
    function connect() {
      if (document.hidden || source) return
      source = new EventSource('/api/events')
      let opened = false
      source.onopen = () => {
        // Catch up after a dropped connection, even without a visibility change.
        if (opened) notify('reconnect')
        opened = true
      }
      for (const type of ['sonarr', 'radarr']) source.addEventListener(type, event => {
        try { notify(type, JSON.parse(event.data)) } catch { /* malformed event; polling still runs */ }
      })
    }
    function visibility() {
      if (document.hidden) { source?.close(); source = null }
      else connect()
    }
    connect()
    document.addEventListener('visibilitychange', visibility)
    return () => { document.removeEventListener('visibilitychange', visibility); source?.close() }
  }, [])
  return <ServerEvents.Provider value={subscribe}>{children}</ServerEvents.Provider>
}

export function useServerEvents(service, callback, enabled = true) {
  const subscribe = useContext(ServerEvents)
  const latest = useRef(callback)
  latest.current = callback
  useEffect(() => {
    if (!enabled || !subscribe) return
    return subscribe((type, data) => {
      if (!document.hidden && (type === service || type === 'reconnect')) latest.current(data)
    })
  }, [subscribe, service, enabled])
}

export function useVisiblePolling(callback, intervalMs, enabled = true, resetKey) {
  const latest = useRef(callback)
  latest.current = callback
  useEffect(() => {
    if (!enabled) return
    let timer
    let running = false
    let disposed = false
    let catchUp = false
    const run = async () => {
      if (document.hidden || running || disposed) return
      running = true
      try { await latest.current() } catch { /* consumers render their request errors */ }
      finally {
        running = false
        if (catchUp && !document.hidden && !disposed) { catchUp = false; run() }
      }
    }
    const start = () => { run(); timer = setInterval(run, intervalMs) }
    const visibility = () => {
      clearInterval(timer)
      if (!document.hidden) { catchUp = running; start() }
    }
    if (!document.hidden) start()
    document.addEventListener('visibilitychange', visibility)
    return () => { disposed = true; clearInterval(timer); document.removeEventListener('visibilitychange', visibility) }
  }, [intervalMs, enabled, resetKey])
}
