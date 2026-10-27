import { test, expect } from 'vitest'
import vectors from '../fixtures/password-vectors.json'
import { validatePassword, passwordError } from '../../src/passwordRules'

const expand = v => (v && typeof v === 'object' && 'repeat' in v ? v.repeat.repeat(v.times) : v)

test('every shared vector row gives the expected result in the client copy', () => {
  expect(vectors.length).toBeGreaterThanOrEqual(30)
  for (const row of vectors) {
    const input = expand(row.input)
    const got = validatePassword(input, row.source)
    expect(got.ok, `${row.source} ${typeof input === 'string' ? input.length : input}`).toBe(row.ok)
    if (row.ok) {
      if ('normalised' in row) expect(got.value).toBe(row.normalised)
      if ('length' in row) expect(got.value.length).toBe(row.length)
    } else expect(got.reason).toBe(row.reason)
  }
})

test('error texts match the server', () => {
  expect(passwordError(validatePassword('short', 'settings'))).toBe('Password must be 8 to 256 characters')
  expect(passwordError(validatePassword('        ', 'settings'))).toBe("Password can't be only spaces")
  expect(passwordError(validatePassword('long enough pw', 'settings'))).toBe('')
})
