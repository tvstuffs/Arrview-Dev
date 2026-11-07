// What the password fields of a form hold right now, by field name, leaving out the empty ones. A browser can fill a password
// (autofill, a password manager) without telling the page: the field shows it, but the page's own copy stays empty until the
// next click. Read the fields when the form is submitted, before any state change, because rendering writes the page's copy
// back into every field. Lay the result over the copy ({ ...values, ...filledPasswords(form) }), so a field that is empty
// still reads the way the copy has it.
export function filledPasswords(form) {
  const filled = {}
  for (const field of form.elements) if (field.type === 'password' && field.name && field.value) filled[field.name] = field.value
  return filled
}
