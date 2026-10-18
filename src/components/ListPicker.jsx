import { useEffect, useId, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import './ListPicker.css'

// A labelled picker: a button that opens a listbox in flow beneath it. DOM focus moves to the listbox while it is open
// and the highlighted option is announced through aria-activedescendant; options themselves are never focused.
// options: [{ value, name, hint?, tag? }]. value is the picked option's value (string).
export default function ListPicker({ label, options, value, onChange, icon = null, describedBy, loadingText = 'Loading…' }) {
  const uid = useId()
  const labelId = `${uid}-label`, valueId = `${uid}-value`, listId = `${uid}-list`
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const root = useRef(null), button = useRef(null), list = useRef(null)
  const selectedIndex = Math.max(0, options.findIndex(option => option.value === value))
  const current = options[selectedIndex]
  const optionId = index => `${listId}-opt-${index}`

  function openList() {
    if (!options.length) return
    setActive(selectedIndex)
    setOpen(true)
  }
  function close(returnFocus = true) {
    setOpen(false)
    if (returnFocus) button.current?.focus()
  }
  function pick(index) {
    const option = options[index]
    if (option) onChange(option.value)
    close()
  }

  useEffect(() => { if (open) list.current?.focus() }, [open])
  useEffect(() => {
    if (open) document.getElementById(optionId(active))?.scrollIntoView?.({ block: 'nearest' })
  }, [open, active]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return
    const outside = event => { if (!root.current?.contains(event.target)) setOpen(false) }
    document.addEventListener('pointerdown', outside, true)
    return () => document.removeEventListener('pointerdown', outside, true)
  }, [open])

  function onButtonKeyDown(event) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); openList() }
  }
  function onListKeyDown(event) {
    const last = options.length - 1
    switch (event.key) {
      case 'ArrowDown': event.preventDefault(); setActive(i => Math.min(i + 1, last)); break
      case 'ArrowUp': event.preventDefault(); setActive(i => Math.max(i - 1, 0)); break
      case 'Home': event.preventDefault(); setActive(0); break
      case 'End': event.preventDefault(); setActive(last); break
      case 'Enter': case ' ': event.preventDefault(); pick(active); break
      case 'Escape': event.preventDefault(); event.stopPropagation(); close(); break
      case 'Tab': close(); break // focus returns to the button first, so Tab moves on from there and is never lost to the body
      default: break
    }
  }

  return (
    <div className="picker" ref={root}>
      <span className="picker-label" id={labelId}>{label}</span>
      <button
        type="button" ref={button} className="picker-button" id={`${uid}-button`}
        aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined}
        aria-labelledby={`${labelId} ${valueId}`} aria-describedby={describedBy}
        disabled={!current}
        onClick={() => (open ? close() : openList())} onKeyDown={onButtonKeyDown}
      >
        {icon && <Icon name={icon} className="icon picker-icon" />}
        <span className="picker-value" id={valueId}>
          {current ? <>
            <span className="picker-name">{current.name}</span>
            {current.hint && <span className="picker-hint">{current.hint}</span>}
            {current.tag && <span className="picker-tag">{current.tag}</span>}
          </> : <span className="picker-name">{loadingText}</span>}
        </span>
        <Icon name="caret-down" className="icon picker-caret" />
      </button>
      {open && (
        <ul
          role="listbox" ref={list} id={listId} className="picker-list" tabIndex={-1}
          aria-labelledby={labelId} aria-activedescendant={optionId(active)} onKeyDown={onListKeyDown}
        >
          {options.map((option, index) => (
            <li
              key={option.value} id={optionId(index)} role="option" aria-selected={index === selectedIndex}
              className={`picker-option${index === active ? ' is-active' : ''}`}
              onMouseMove={() => { if (index !== active) setActive(index) }}
              onClick={() => pick(index)}
            >
              <span className="picker-check">{index === selectedIndex && <Icon name="check" />}</span>
              <span className="picker-value">
                <span className="picker-name">{option.name}</span>
                {option.hint && <span className="picker-hint">{option.hint}</span>}
                {option.tag && <span className="picker-tag">{option.tag}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
