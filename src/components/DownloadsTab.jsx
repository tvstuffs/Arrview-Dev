import { useState, useCallback } from 'react'
import './DownloadsTab.css'
import { useVisiblePolling } from '../hooks/lifecycle'
import ConfirmSheet from './ConfirmSheet'
import { checkedFetch } from '../actions'
import NzbSearchModal from './NzbSearchModal'

function formatBytes(mb) {
  if (mb == null) return '—'
  const b = parseFloat(mb)
  if (b >= 1024) return `${(b / 1024).toFixed(1)} GB`
  return `${b.toFixed(0)} MB`
}

function formatSpeed(kbps) {
  if (!kbps) return '—'
  const k = parseFloat(kbps)
  if (k >= 1024) return `${(k / 1024).toFixed(1)} MB/s`
  return `${k.toFixed(0)} KB/s`
}

function QueueItem({ slot, onPause, onResume, onDelete }) {
  const pct = parseInt(slot.percentage || 0)
  const isDone = slot.status === 'Completed'
  const isPaused = slot.status === 'Paused'

  return (
    <div className="queue-item card">
      <div className="queue-item-header">
        <div className="queue-item-name truncate" title={slot.filename}>{slot.filename}</div>
        <div className="queue-item-actions">
          {isPaused ? (
            <button className="btn btn-success btn-sm" onClick={() => onResume(slot.nzo_id)} aria-label="Resume" title="Resume">▶</button>
          ) : (
            <button className="btn btn-secondary btn-sm" onClick={() => onPause(slot.nzo_id)} aria-label="Pause" title="Pause">⏸</button>
          )}
          <button className="btn btn-danger btn-sm" onClick={() => onDelete(slot.nzo_id)} aria-label="Delete" title="Delete">✕</button>
        </div>
      </div>

      <div className="queue-item-meta">
        {slot.cat && <span className="badge badge-muted">{slot.cat}</span>}
        <span className="text-sm text-muted">
          {formatBytes(parseFloat(slot.mb) - parseFloat(slot.mbleft))} / {formatBytes(slot.mb)}
        </span>
        <span className="text-sm text-muted">{slot.timeleft || '—'} left</span>
        {isPaused && <span className="badge badge-warning">Paused</span>}
      </div>

      <div className="progress-bar">
        <div
          className="progress-fill"
          style={{ width: `${pct}%`, background: isPaused ? 'var(--warning)' : undefined }}
        />
      </div>
      <div className="queue-item-pct text-xs text-muted">{pct}%</div>
    </div>
  )
}

function HistoryItem({ item }) {
  const statusClass =
    item.status === 'Completed' ? 'success' :
    item.status === 'Failed'    ? 'danger'  : 'muted'
  return (
    <div className="history-item">
      <div className="truncate" style={{flex:1}} title={item.name}>{item.name}</div>
      <span className={`badge badge-${statusClass} text-xs`}>{item.status}</span>
      <span className="text-xs text-muted">{formatBytes(item.bytes != null ? Number(item.bytes) / (1024 * 1024) : item.mb)}</span>
    </div>
  )
}

export default function DownloadsTab({ onToast, canSearch = true }) {
  const [historyLimit, setHistoryLimit] = useState(15)
  const [historyTotal, setHistoryTotal] = useState(null)
  const [queue, setQueue] = useState(null)
  const [history, setHistory] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [removeSlot, setRemoveSlot] = useState(null)
  const [showSearch, setShowSearch] = useState(false)

  const fetchData = useCallback(async () => {
    try {
      const [qRes, hRes] = await Promise.all([
        fetch('/api/sabnzbd/queue'),
        fetch(`/api/sabnzbd/history?limit=${historyLimit}`),
      ])
      if (!qRes.ok) throw new Error((await qRes.json()).error)
      const qData = await qRes.json()
      if (!hRes.ok) throw new Error('Could not load download history')
      const hData = await hRes.json()
      setHistoryTotal(Number.isFinite(Number(hData?.history?.noofslots)) ? Number(hData.history.noofslots) : null)
      setQueue(qData.queue)
      setHistory(hData?.history?.slots || [])
      setError(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [historyLimit])

  useVisiblePolling(fetchData, queue?.status === 'Downloading' ? 2000 : 10000, true, historyLimit)

  async function postAction(mode, nzo_id) {
    try {
      const r = await fetch('/api/sabnzbd/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, nzo_id }),
      })
      const data = await r.json()
      if (data.error) throw new Error(data.error)
      fetchData()
    } catch (e) {
      onToast(`Error: ${e.message}`, 'error')
    }
  }

  async function handlePauseAll() { await postAction('pause') }
  async function handleResumeAll() { await postAction('resume') }
  async function handlePause(id) { await postAction('pause', id) }
  async function handleResume(id) { await postAction('resume', id) }
  async function handleDelete(id) {
    await checkedFetch('/api/sabnzbd/action', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'queue', name: 'delete', value: id }) })
    onToast('Item removed from the SABnzbd queue', 'info')
    fetchData()
  }

  if (loading) {
    return (
      <div className="empty-state">
        <span className="spinner" />
        <span>Loading queue…</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">⚠️</div>
        <strong>Cannot reach SABnzbd</strong>
        <p className="text-sm text-muted">{error}</p>
        <button className="btn btn-secondary mt-4" onClick={fetchData}>Retry</button>
      </div>
    )
  }

  const slots = queue?.slots || []
  const isDownloading = queue?.status === 'Downloading'
  const speed = formatSpeed(queue?.kbpersec)
  const eta = queue?.timeleft

  return (
    <div className="downloads-tab">
      {removeSlot && <ConfirmSheet title="Remove download?" description={`Remove “${removeSlot.filename}” from the SABnzbd queue. This does not remove it from Sonarr or Radarr.`}
        actions={[{ label: 'Remove from SABnzbd Queue', run: () => handleDelete(removeSlot.nzo_id) }]}
        onClose={() => setRemoveSlot(null)} />}
      {showSearch && (
        <NzbSearchModal onClose={() => setShowSearch(false)} onToast={onToast} />
      )}

      {/* Queue stats bar */}
      <div className="queue-statsbar card">
        <div className="stat-group">
          <span className="stat-label">Status <span className="badge badge-success" title="Refreshes every 2 seconds downloading; every 10 seconds idle">Live</span></span>
          <span className={`badge ${isDownloading ? 'badge-success' : 'badge-muted'}`}>
            {queue?.status || 'Unknown'}
          </span>
        </div>
        <div className="stat-group">
          <span className="stat-label">Speed</span>
          <span className="stat-value">{isDownloading ? speed : '—'}</span>
        </div>
        <div className="stat-group">
          <span className="stat-label">Remaining</span>
          <span className="stat-value">{eta || '—'}</span>
        </div>
        <div className="stat-group">
          <span className="stat-label">Items</span>
          <span className="stat-value">{slots.length}</span>
        </div>
        <div className="statsbar-actions ml-auto">
          {canSearch && <button className="btn btn-primary btn-sm" onClick={() => setShowSearch(true)}>🔎 Search NZBs</button>}
          {isDownloading
            ? <button className="btn btn-secondary btn-sm" onClick={handlePauseAll}>⏸ Pause All</button>
            : <button className="btn btn-success btn-sm" onClick={handleResumeAll}>▶ Resume All</button>
          }
          <button className="btn btn-ghost btn-sm" onClick={fetchData} aria-label="Refresh downloads" title="Refresh downloads">
            🔄 Refresh
          </button>
        </div>
      </div>

      {/* Active queue */}
      <section className="section">
        <h2 className="section-title">Queue ({slots.length})</h2>
        {slots.length === 0 ? (
          <div className="empty-state" style={{padding:'32px'}}>
            <div className="empty-state-icon">✅</div>
            <span>Queue is empty</span>
          </div>
        ) : (
          <div className="queue-list">
            {slots.map(slot => (
              <QueueItem
                key={slot.nzo_id}
                slot={slot}
                onPause={handlePause}
                onResume={handleResume}
                onDelete={() => setRemoveSlot(slot)}
              />
            ))}
          </div>
        )}
      </section>

      {/* History */}
      {history && history.length > 0 && (
        <section className="section">
          <h2 className="section-title">Recent History</h2>
          <div className="card">
            {history.map((item, i) => (
              <div key={item.nzo_id || i}>
                <HistoryItem item={item} />
                {i < history.length - 1 && <div className="divider" style={{margin:'0 0'}} />}
              </div>
            ))}
          </div>
          {historyLimit < 1000 && (historyTotal != null ? history.length < historyTotal : history.length >= historyLimit) && <button className="btn btn-secondary" onClick={() => setHistoryLimit(limit => Math.min(1000, limit + 15))}>Load more</button>}
        </section>
      )}
    </div>
  )
}
