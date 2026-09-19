import React from 'react'
import { test, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import App from '../../src/App'
vi.mock('../../src/components/ConfigPage.jsx', () => ({ default: () => <h1>Fixture setup</h1> }))
vi.mock('../../src/components/Dashboard.jsx', () => ({ default: () => <h1>Fixture dashboard</h1> }))
afterEach(() => vi.unstubAllGlobals())
for (const failure of ['network', '503']) {
  test(`${failure} startup failure is recoverable, never first-run setup`, async () => {
    const fetch = vi.fn().mockImplementationOnce(() => failure === 'network' ? Promise.reject(new Error('offline')) :
      Promise.resolve({ ok: false })).mockResolvedValue({ ok: true, json: async () => ({ sonarr: { url: 'fixture', apikey: 'fixture' } }) })
    vi.stubGlobal('fetch', fetch)
    render(<App />)
    expect(await screen.findByRole('heading', { name: /Can’t reach/ })).toBeVisible()
    expect(screen.queryByText('Fixture setup')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Fixture dashboard')).toBeVisible()
  })
}
test('reachable unconfigured server still opens setup', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }))
  render(<App />)
  expect(await screen.findByText('Fixture setup')).toBeVisible()
})
