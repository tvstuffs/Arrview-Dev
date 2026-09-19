import React from 'react'
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import InstallHelp from '../../src/components/InstallHelp'

function property(object, name, value) { Object.defineProperty(object, name, { configurable: true, value }) }
function offer(outcome = 'accepted', reject = false) {
  const event = new Event('beforeinstallprompt', { cancelable: true })
  event.prompt = vi.fn(() => reject ? Promise.reject(new Error('fixture')) : Promise.resolve())
  event.userChoice = Promise.resolve({ outcome })
  act(() => window.dispatchEvent(event))
  return event
}
beforeEach(() => {
  property(navigator, 'userAgent', 'Desktop browser')
  property(navigator, 'platform', '')
  property(navigator, 'maxTouchPoints', 0)
  property(navigator, 'standalone', false)
  window.isSecureContext = true
  act(() => {
    window.dispatchEvent(new Event('appinstalled')) // clear any old offer
    const event = new Event('change'); event.matches = false
    window.matchMedia().dispatchEvent(event)
  })
})
describe('Home Screen help', () => {
  test('iPhone and desktop-user-agent iPad get Safari instructions', () => {
    property(navigator, 'platform', 'MacIntel'); property(navigator, 'maxTouchPoints', 5)
    render(<InstallHelp />)
    expect(screen.getByText(/In Safari, tap Share/)).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Install ArrView' })).not.toBeInTheDocument()
  })
  test('Android HTTP explains shortcut rather than full installation', () => {
    property(navigator, 'userAgent', 'Android Chrome'); window.isSecureContext = false
    render(<InstallHelp />)
    expect(screen.getByText(/creates a shortcut that opens in Chrome/)).toBeVisible()
    expect(screen.getByText(/Offline startup is unavailable/)).toBeVisible()
  })
  test('Android HTTPS offers full Chrome menu instructions', () => {
    property(navigator, 'userAgent', 'Android Chrome')
    render(<InstallHelp />)
    expect(screen.getByText(/Install app \(or Add to Home screen\)/)).toBeVisible()
    expect(screen.queryByText(/Offline startup is unavailable/)).not.toBeInTheDocument()
  })
  test('retains an early Chromium prompt and consumes it only once', async () => {
    const event = offer()
    expect(event.defaultPrevented).toBe(true)
    render(<InstallHelp />)
    fireEvent.click(screen.getByRole('button', { name: 'Install ArrView' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Installation requested')
    expect(event.prompt).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Install ArrView' })).not.toBeInTheDocument()
  })
  test('dismissed install offers manual instructions without claiming installation', async () => {
    offer('dismissed'); render(<InstallHelp />)
    fireEvent.click(screen.getByRole('button', { name: 'Install ArrView' }))
    expect(await screen.findByRole('status')).toHaveTextContent('browser menu')
    expect(screen.getByRole('heading', { name: 'Add to Home Screen' })).toBeVisible()
  })
  test('failed prompt does not leave a broken Install button', async () => {
    offer('dismissed', true); render(<InstallHelp />)
    fireEvent.click(screen.getByRole('button', { name: 'Install ArrView' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Installation could not open')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
  test('appinstalled hides install UI and explains external browser links', () => {
    offer(); render(<InstallHelp />)
    act(() => window.dispatchEvent(new Event('appinstalled')))
    expect(screen.getByRole('heading', { name: 'Home Screen app' })).toBeVisible()
    expect(screen.getByText(/may open your browser/)).toBeVisible()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
