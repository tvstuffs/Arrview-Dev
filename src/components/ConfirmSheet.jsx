import { useState } from 'react'
import Sheet from './Sheet'

// Own the pending/error state so a failed or partial action cannot look successful.
export default function ConfirmSheet({ title, description, actions, onClose }) {
  const [pending, setPending] = useState(null)
  const [error, setError] = useState(null)
  async function execute(action) {
    if (pending !== null) return
    setPending(action.label); setError(null)
    try { await action.run(); onClose() }
    catch (error) { setError(error.message || 'Action failed. Please try again.') }
    finally { setPending(null) }
  }
  return <Sheet title={title} onClose={onClose} busy={pending !== null} className="confirm-sheet">
    <div className="confirm-body">
      <p>{description}</p>
      {error && <p className="error-banner" role="alert">{error}</p>}
      {actions.map(action => <button key={action.label} className="btn btn-danger" disabled={pending !== null}
        onClick={() => execute(action)}>{pending === action.label ? 'Working…' : action.label}</button>)}
      <button className="btn btn-secondary" autoFocus disabled={pending !== null} onClick={onClose}>Cancel</button>
    </div>
  </Sheet>
}
