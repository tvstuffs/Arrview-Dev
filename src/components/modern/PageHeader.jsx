import { useEffect, useRef, useState } from 'react'
import Icon from '../Icon.jsx'
import { useScreen } from './ScreenContext.js'

export function SettingsLink({ className = 'm-iconbtn' }) {
  return <a className={className} href="#/settings" aria-label="Settings" title="Settings"><Icon name="gear-six" /></a>
}

// Enter in a search field: whatever the field already does on Enter runs first (its own handler), then the field lets go
// of focus so the phone keyboard and its form bar go away (B4).
export function blurOnEnter(event) {
  if (event.key === 'Enter' && !event.nativeEvent?.isComposing) event.currentTarget.blur()
}

// A page's search field. On a short, compact screen it starts as an icon button named like the field, which expands in
// place and focuses the field; it starts expanded while there is search text.
export function SearchField({ label, placeholder, value, onChange }) {
  const sc = useScreen()
  const collapsible = sc.height === 'short' && sc.width === 'compact'
  const [open, setOpen] = useState(Boolean(value))
  const input = useRef(null)
  const focusNext = useRef(false)
  useEffect(() => { if (focusNext.current && input.current) { focusNext.current = false; input.current.focus() } })
  if (collapsible && !open && !value) {
    return <button type="button" className="m-iconbtn m-search-toggle" aria-label={label} title={label} onClick={() => { focusNext.current = true; setOpen(true) }}>
      <Icon name="magnifying-glass" />
    </button>
  }
  return <div className="m-search">
    <Icon name="magnifying-glass" />
    <input ref={input} type="text" aria-label={label} placeholder={placeholder} value={value} enterKeyHint="search"
      onChange={e => onChange(e.target.value)} onKeyDown={blurOnEnter} onBlur={e => { if (!e.target.value) setOpen(false) }} />
  </div>
}

// Page title row. Phones: + icon button and gear link (not when the rail carries Settings). Wide screens: text "Add" button.
// `meta`, `search`, `toolbar` and `view` are the page's own line and controls. On regular-height screens they render as
// before: the meta line, then one wrapping row of controls with the view toggle last. On short screens the header is
// condensed: one title row (title, meta inline, the page actions and the view toggle at the end) and one toolbar row that
// never wraps and scrolls sideways; below 520 px of height the two share one row (.m-shell[data-header-rows="one"]).
export default function PageHeader({ title, phone, addLabel, onAdd, gear = false, meta = null, search = null, toolbar = null, view = null }) {
  const sc = useScreen()
  const condensed = sc.height === 'short'
  const settings = phone && gear && !sc.settingsInRail
  const add = addLabel && (phone
    ? <button className="m-iconbtn" aria-label={addLabel} title={addLabel} onClick={onAdd}><Icon name="plus" /></button>
    : <button className="btn btn-primary btn-sm" onClick={onAdd}><Icon name="plus" /> {addLabel}</button>)
  if (!condensed) return <>
    <header className="m-pageheader">
      <h1>{title}</h1>
      <div className="m-pageheader-actions">{add}{settings && <SettingsLink />}</div>
    </header>
    {meta && <p className="m-meta">{meta}</p>}
    {(search || toolbar || view) && <div className="m-controls">{search}{toolbar}{view}</div>}
  </>
  return <header className="m-pageheader is-condensed">
    <div className="m-titlerow">
      <h1>{title}</h1>
      {meta && <p className="m-meta">{meta}</p>}
      <div className="m-pageheader-actions">{add}{view}{settings && <SettingsLink />}</div>
    </div>
    {(search || toolbar) && <div className="m-toolbar">{search}{toolbar}</div>}
  </header>
}
