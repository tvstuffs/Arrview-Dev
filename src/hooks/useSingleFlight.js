import { useEffect, useRef } from 'react'

// One shared request coordinator: every trigger of a request (poll tick, explicit refresh, change of inputs) goes
// through it, so at most one request is in flight and every start re-checks the current gates (mounted, document
// visible, `eligible()`).
//   trigger()  asks for a fresh request. During a request it queues exactly one rerun (if `rerunIf()` still holds);
//              while a gate is closed it only records that a refresh is owed, paid when the document is visible again.
//   tick()     a periodic poll: dropped while a request is in flight or a gate is closed.
// Unmounting closes the mounted gate and drops any queued rerun, so a response that arrives later starts nothing.
export function useSingleFlight(request, { eligible = () => true, rerunIf = () => true } = {}) {
  const latest = useRef(null)
  latest.current = { request, eligible, rerunIf }
  const flight = useRef(null)
  if (!flight.current) {
    const s = { mounted: false, inflight: false, again: false, owed: false }
    const ready = () => s.mounted && !document.hidden && latest.current.eligible()
    const run = async () => {
      s.inflight = true
      s.owed = false
      try { await latest.current.request() } catch { /* the request reports its own errors */ }
      finally {
        s.inflight = false
        if (s.again) {
          s.again = false
          if (s.mounted && latest.current.rerunIf()) { if (ready()) run(); else s.owed = true }
        }
      }
    }
    flight.current = {
      s,
      ready,
      run,
      trigger: () => {
        if (!s.mounted) return
        if (!ready()) { s.owed = true; return }
        if (s.inflight) { s.again = true; return }
        return run()
      },
      tick: () => { if (!s.inflight && ready()) return run() },
    }
  }
  useEffect(() => {
    const { s, ready, run } = flight.current
    s.mounted = true
    // Runs after the polling restart for the same event, so a refresh that polling already paid is not repeated.
    const resume = () => { if (!document.hidden) queueMicrotask(() => { if (s.owed && !s.inflight && ready()) run() }) }
    document.addEventListener('visibilitychange', resume)
    return () => { s.mounted = false; s.again = false; s.owed = false; document.removeEventListener('visibilitychange', resume) }
  }, [])
  return flight.current
}
