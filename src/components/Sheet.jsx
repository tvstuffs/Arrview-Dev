import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import './Sheet.css'

export default function Sheet({ title, children, onClose, busy = false, className = '' }) {
  const dialog = useRef(null)
  const titleId = useId()
  useEffect(() => {
    const previous = document.activeElement
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialog.current.showModal()
    return () => {
      document.body.style.overflow = overflow
      if (previous?.isConnected) previous.focus()
    }
  }, [])
  return createPortal(
    <dialog ref={dialog} className={`sheet ${className}`} aria-labelledby={titleId}
      onCancel={event => { event.preventDefault(); if (!busy) onClose() }}
      onClick={event => { if (event.target === event.currentTarget && !busy) {
        const bounds = event.currentTarget.getBoundingClientRect()
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose()
      } }}>
      <header className="sheet-header">
        <h2 id={titleId}>{title}</h2>
        <button className="btn btn-ghost" aria-label="Close dialog" disabled={busy} onClick={onClose}>✕</button>
      </header>
      <div className="sheet-content">{children}</div>
    </dialog>, document.body,
  )
}
