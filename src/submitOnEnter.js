// Enter in a field submits its form from the page's own key handler, not from the browser's implicit submission.
//
// On one real Edge the Enter key reached the page (keydown and keyup arrived) but the browser never ran the form's own submission
// for it: no change, click or submit event followed, so Enter did nothing until the field was left and entered again. A page that
// submitted on keydown signed in at once on the same browser. Submitting on keydown does not depend on that browser step.
//
// Two things take that step away: the browser (or an extension) not running it, and something cancelling the keydown, after which the
// browser never reaches its key-press step either. The log of the real Edge cannot tell them apart, so the handler covers both: nothing
// in these forms handles Enter itself, so a key that is already cancelled is no reason to stand down; it is submitted anyway.
//
// The handler keeps the browser's own rules where they matter: only a text-like field that is in a form, never a button or a text
// area; not while an input method is composing; nothing while the form's default button is disabled (a request is already
// running); and the key is always cancelled once the handler takes it, so a browser that does run its own submission cannot submit
// the form a second time. Use it as the form's onKeyDown.
const FIELDS = new Set(['text', 'password', 'email', 'search', 'tel', 'url', 'number'])
const DEFAULT_BUTTON = 'button:not([type]), button[type="submit"], input[type="submit"]'

export function submitOnEnter(event) {
  if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
  const field = event.target
  if (!field || field.tagName !== 'INPUT' || !FIELDS.has(field.type) || !field.form) return
  event.preventDefault()
  const form = field.form
  const button = form.querySelector(DEFAULT_BUTTON)
  if (button && button.disabled) return
  if (typeof form.requestSubmit === 'function') form.requestSubmit()
  else form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
}
