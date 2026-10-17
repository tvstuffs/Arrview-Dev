import React from 'react'
import fs from 'node:fs'
import path from 'node:path'
import { test, expect } from 'vitest'
import { render } from '@testing-library/react'
import Icon, { ICON_NAMES } from '../../src/components/Icon'

test('Icon renders a decorative 256 viewBox svg using currentColor', () => {
  const { container } = render(<Icon name="check" />)
  const svg = container.querySelector('svg')
  expect(svg).toHaveAttribute('aria-hidden', 'true')
  expect(svg).toHaveAttribute('fill', 'currentColor')
  expect(svg).toHaveAttribute('viewBox', '0 0 256 256')
  expect(svg).toHaveAttribute('focusable', 'false')
  expect(svg.querySelector('path').getAttribute('d')).toMatch(/^M/)
})
test('Icon fill weight differs from regular where a fill glyph exists and falls back otherwise', () => {
  const path = weight => render(<Icon name="play" weight={weight} />).container.querySelector('path').getAttribute('d')
  expect(path('fill')).not.toBe(path('regular'))
  const trash = weight => render(<Icon name="trash" weight={weight} />).container.querySelector('path').getAttribute('d')
  expect(trash('fill')).toBe(trash('regular'))
})
test('unknown icon names render nothing', () => {
  const { container } = render(<Icon name="no-such-icon" />)
  expect(container).toBeEmptyDOMElement()
})
test('every exported name renders and every name used in the app resolves', () => {
  for (const name of ICON_NAMES) expect(render(<Icon name={name} />).container.querySelector('svg')).not.toBeNull()
  const dir = path.resolve(__dirname, '../../src/components')
  const used = new Set()
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.jsx'))) {
    const source = fs.readFileSync(path.join(dir, file), 'utf8')
    for (const m of source.matchAll(/<Icon name="([a-z-]+)"/g)) used.add(m[1])
    for (const m of source.matchAll(/<Icon name=\{([^}]*)\}/g)) for (const q of m[1].matchAll(/'([a-z-]+)'/g)) used.add(q[1])
    for (const m of source.matchAll(/\bicon: '([a-z-]+)'/g)) used.add(m[1])
  }
  expect(used.size).toBeGreaterThan(10)
  for (const name of used) expect(ICON_NAMES, `icon "${name}" is used but not defined`).toContain(name)
})
