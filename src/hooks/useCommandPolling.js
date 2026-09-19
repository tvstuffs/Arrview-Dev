import { useCallback, useEffect, useRef } from 'react'

// Track user-started Sonarr commands without leaving timers/listeners behind
// when a tab closes. Hiding the app pauses checks; returning checks immediately.
export function useCommandPolling() {
  const jobs = useRef(new Set())
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    const visibility = () => {
      for (const job of jobs.current) {
        clearTimeout(job.timer)
        if (document.hidden) job.controller?.abort()
        else job.check()
      }
    }
    document.addEventListener('visibilitychange', visibility)
    return () => {
      mounted.current = false
      document.removeEventListener('visibilitychange', visibility)
      for (const job of jobs.current) { clearTimeout(job.timer); job.controller?.abort() }
      jobs.current.clear()
    }
  }, [])
  return useCallback((id, done) => {
    if (!mounted.current) return
    const job = { deadline: Date.now() + 90000 }
    const finish = (status, result) => { jobs.current.delete(job); if (mounted.current) done(status, result) }
    job.check = async () => {
      if (!mounted.current || document.hidden || !jobs.current.has(job)) return
      clearTimeout(job.timer)
      if (Date.now() > job.deadline) { finish('timeout', null); return }
      job.controller?.abort()
      const controller = new AbortController()
      job.controller = controller
      try {
        const response = await fetch(`/api/sonarr/command/${id}`, { signal: controller.signal })
        if (!response.ok) throw new Error('Command unavailable')
        const data = await response.json()
        if (controller.signal.aborted || !mounted.current) return
        if (data.status === 'completed' || data.status === 'failed') { finish(data.status, data.result); return }
      } catch { /* retry until deadline, unless suspended or disposed */ }
      if (!controller.signal.aborted && mounted.current && !document.hidden) job.timer = setTimeout(job.check, 3000)
    }
    jobs.current.add(job)
    if (!document.hidden) job.timer = setTimeout(job.check, 3000)
  }, [])
}
