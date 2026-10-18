import { createContext, useContext, useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import Icon from './Icon.jsx'
import './Sheet.css'

// Sheets are portalled to <body>, outside the Modern shell; the shell provides this class through context
// so its sheets get the neutral focus ring. Classic provides nothing and keeps the default.
export const SheetClassContext = createContext('')

// `footer` renders after the scrolling content and stays visible; `initialFocus` is a ref focused right after showModal().
export default function Sheet({ title, children, onClose, busy = false, className = '', footer = null, initialFocus = null }) {
  const themeClass = useContext(SheetClassContext)
  const dialog = useRef(null)
  const titleId = useId()
  useEffect(() => {
    const previous = document.activeElement
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialog.current.showModal()
    initialFocus?.current?.focus()
    return () => {
      document.body.style.overflow = overflow
      if (previous?.isConnected) previous.focus()
    }
  }, [])
  return createPortal(
    <dialog ref={dialog} className={`sheet ${className} ${themeClass}`.trim()} aria-labelledby={titleId}
      onCancel={event => { event.preventDefault(); if (!busy) onClose() }}
      onClick={event => { if (event.target === event.currentTarget && !busy) {
        const bounds = event.currentTarget.getBoundingClientRect()
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose()
      } }}>
      <header className="sheet-header">
        <h2 id={titleId}>{title}</h2>
        <button className="btn btn-ghost" aria-label="Close dialog" title="Close dialog" disabled={busy} onClick={onClose}><Icon name="x" /></button>
      </header>
      <div className="sheet-content">{children}</div>
      {footer}
    </dialog>, document.body,
  )
}
