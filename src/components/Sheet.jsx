import { createContext, useContext, useEffect, useId, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import Icon from './Icon.jsx'
import { useScreenHeight } from '../hooks/useScreenHeight'
import './Sheet.css'

// Sheets are portalled to <body>, outside the Modern shell; the shell provides this class through context
// so its sheets get the neutral focus ring. Classic provides nothing and keeps the default.
export const SheetClassContext = createContext('')

const TEXT_TYPES = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number'])
export const isTextField = el => Boolean(el) && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && TEXT_TYPES.has(el.type)) || el.isContentEditable === true)

// While a text field inside the sheet has focus and the keyboard has shrunk the visual viewport, the sheet is sized and
// placed to the visual viewport so the field and the header (with its actions) stay above the keyboard.
function useKeyboardFit(dialog) {
  useEffect(() => {
    const vv = window.visualViewport
    const el = dialog.current
    if (!vv || !el) return undefined
    const fit = () => {
      const focused = el.contains(document.activeElement) && isTextField(document.activeElement)
      // The keyboard only takes height away. A visual viewport that is also narrower than the layout viewport means the
      // page is zoomed or wider than the screen, not a keyboard.
      const keyboard = focused && vv.height < window.innerHeight - 1 && vv.width >= window.innerWidth - 1
      el.classList.toggle('is-keyboard', keyboard)
      if (keyboard) {
        el.style.setProperty('--kb-top', `${Math.max(0, vv.offsetTop)}px`)
        el.style.setProperty('--kb-height', `${vv.height}px`)
      } else {
        el.style.removeProperty('--kb-top'); el.style.removeProperty('--kb-height')
      }
    }
    const later = () => setTimeout(fit, 0)
    vv.addEventListener('resize', fit); vv.addEventListener('scroll', fit)
    el.addEventListener('focusin', fit); el.addEventListener('focusout', later)
    return () => {
      vv.removeEventListener('resize', fit); vv.removeEventListener('scroll', fit)
      el.removeEventListener('focusin', fit); el.removeEventListener('focusout', later)
    }
  }, [])
}

// `footer` renders after the scrolling content and stays visible; `initialFocus` is a ref focused right after showModal().
// `action` is the sheet's primary action: on short screens (<html data-screen-height="short">) it moves into the header
// (Close first, then the title, then the action) and the footer is not rendered; `notice` (an error the footer carried)
// then shows at the top of the content.
export default function Sheet({ title, children, onClose, busy = false, className = '', footer = null, initialFocus = null, action = null, notice = null }) {
  const themeClass = useContext(SheetClassContext)
  const dialog = useRef(null)
  const titleId = useId()
  const short = useScreenHeight() === 'short'
  const inHeader = short && action !== null
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
  // B4: a field that still has focus when the sheet goes would leave the iOS keyboard's form bar up. Layout-effect
  // cleanups run before the dialog leaves the document and before the effect above focuses the opener.
  useLayoutEffect(() => () => {
    const active = document.activeElement
    if (dialog.current && dialog.current.contains(active) && isTextField(active)) active.blur()
  }, [])
  useKeyboardFit(dialog)
  const close = <button className="btn btn-ghost sheet-close" aria-label="Close dialog" title="Close dialog" disabled={busy} onClick={onClose}><Icon name="x" /></button>
  return createPortal(
    <dialog ref={dialog} className={`sheet ${className} ${themeClass}${inHeader ? ' has-action' : ''}`.trim().replace(/\s+/g, ' ')} aria-labelledby={titleId}
      onCancel={event => { event.preventDefault(); if (!busy) onClose() }}
      onClick={event => { if (event.target === event.currentTarget && !busy) {
        const bounds = event.currentTarget.getBoundingClientRect()
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose()
      } }}>
      <header className="sheet-header">
        {inHeader && close}
        <h2 id={titleId}>{title}</h2>
        {inHeader ? action : close}
      </header>
      <div className="sheet-content">{inHeader && notice && <div className="sheet-notice">{notice}</div>}{children}</div>
      {!inHeader && footer}
    </dialog>, document.body,
  )
}
