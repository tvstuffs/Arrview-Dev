// Copies `text`, selecting the visible `field` that holds it. The Clipboard API only exists on secure pages
// (HTTPS or localhost) and ArrView is usually opened on a plain http address on the local network, so the
// fallback uses the older copy command on the selected field. Resolves to whether the copy happened; when it
// did not, the field stays selected so the person can copy it by hand.
export async function copyText(text, field) {
  if (field) {
    field.focus()
    field.select()
    field.setSelectionRange?.(0, text.length)
  }
  if (window.isSecureContext && navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(text); return true } catch { /* use the field instead */ }
  }
  if (!field || typeof document.execCommand !== 'function') return false
  try { return document.execCommand('copy') } catch { return false }
}
