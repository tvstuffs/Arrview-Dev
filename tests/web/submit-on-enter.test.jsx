import React from 'react'
import { test, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { submitOnEnter } from '../../src/submitOnEnter'

// Enter in a field submits its form from the page's own key handler. On one real Edge the key reached the page (keydown and keyup)
// but the browser never ran the form's own submission for it (no change, click or submit event followed), so Enter did nothing.
// jsdom does not run implicit submission either, so these tests only pass when the handler does the submitting itself.
function Form({ onSubmit, disabled = false }) {
  return (
    <form onSubmit={e => { e.preventDefault(); onSubmit() }} onKeyDown={submitOnEnter}>
      <input aria-label="name" type="text" />
      <input aria-label="secret" type="password" />
      <input aria-label="agree" type="checkbox" />
      <textarea aria-label="notes" />
      <button type="button">Back</button>
      <button type="submit" disabled={disabled}>Go</button>
    </form>
  )
}
const enter = (target, init = {}) => fireEvent.keyDown(target, { key: 'Enter', ...init })

test('Enter in a text or password field submits the form and cancels the key, so the browser cannot submit it a second time', () => {
  const onSubmit = vi.fn()
  render(<Form onSubmit={onSubmit} />)
  expect(enter(screen.getByLabelText('name'))).toBe(false)
  expect(onSubmit).toHaveBeenCalledTimes(1)
  expect(enter(screen.getByLabelText('secret'))).toBe(false)
  expect(onSubmit).toHaveBeenCalledTimes(2)
})

test('other keys, a text area, a checkbox and a button are left alone', () => {
  const onSubmit = vi.fn()
  render(<Form onSubmit={onSubmit} />)
  expect(fireEvent.keyDown(screen.getByLabelText('secret'), { key: 'a' })).toBe(true)
  expect(fireEvent.keyDown(screen.getByLabelText('secret'), { key: ' ' })).toBe(true)
  expect(enter(screen.getByLabelText('notes'))).toBe(true)
  expect(enter(screen.getByLabelText('agree'))).toBe(true)
  expect(enter(screen.getByRole('button', { name: 'Back' }))).toBe(true)
  expect(enter(screen.getByRole('button', { name: 'Go' }))).toBe(true)
  expect(onSubmit).not.toHaveBeenCalled()
})

test('nothing is submitted while the default button is disabled, as with the browser\'s own submission', () => {
  const onSubmit = vi.fn()
  render(<Form onSubmit={onSubmit} disabled />)
  // the key is still taken, so the browser does not do something else with it
  expect(enter(screen.getByLabelText('secret'))).toBe(false)
  expect(onSubmit).not.toHaveBeenCalled()
})

test('Enter that confirms an input-method composition is left alone', () => {
  const onSubmit = vi.fn()
  render(<Form onSubmit={onSubmit} />)
  expect(enter(screen.getByLabelText('name'), { isComposing: true })).toBe(true)
  expect(onSubmit).not.toHaveBeenCalled()
})

// Something outside the page can cancel the key before the page sees it (an extension does); the browser then never reaches its own
// submission either, so a key that is already cancelled must still submit.
test('Enter submits the form even when something cancelled the key before the page saw it', () => {
  const onSubmit = vi.fn()
  render(<Form onSubmit={onSubmit} />)
  const field = screen.getByLabelText('secret')
  field.addEventListener('keydown', e => e.preventDefault())
  enter(field)
  expect(onSubmit).toHaveBeenCalledTimes(1)
})

test('where requestSubmit is missing the form still gets a submit event', () => {
  const onSubmit = vi.fn()
  const original = HTMLFormElement.prototype.requestSubmit
  delete HTMLFormElement.prototype.requestSubmit
  try {
    render(<Form onSubmit={onSubmit} />)
    enter(screen.getByLabelText('secret'))
    expect(onSubmit).toHaveBeenCalledTimes(1)
  } finally {
    HTMLFormElement.prototype.requestSubmit = original
  }
})
