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
test('the Modern layout icons are defined in regular weight', () => {
  for (const name of ['plus', 'dots-three', 'squares-four', 'grid-nine', 'list']) {
    expect(ICON_NAMES).toContain(name)
    expect(render(<Icon name={name} />).container.querySelector('path').getAttribute('d')).toMatch(/^M/)
  }
})
test('the Upcoming icons (stack, monitor-play, disc) render from the staged Phosphor regular set', () => {
  const staged = { 'stack': 'M230.91,172A8,8,0,0,1,228,182.91', 'monitor-play': 'M208,40H48A24,24,0,0,0,24,64V176', 'disc': 'M128,24A104,104,0,1,0,232,128' }
  for (const [name, start] of Object.entries(staged)) {
    expect(ICON_NAMES).toContain(name)
    const d = render(<Icon name={name} />).container.querySelector('path').getAttribute('d')
    expect(d.startsWith(start), name).toBe(true)
    expect(render(<Icon name={name} weight="fill" />).container.querySelector('path').getAttribute('d')).toBe(d)
  }
})
test('unknown icon names render nothing', () => {
  const { container } = render(<Icon name="no-such-icon" />)
  expect(container).toBeEmptyDOMElement()
})
test('every exported name renders and every name used in the app resolves', () => {
  for (const name of ICON_NAMES) expect(render(<Icon name={name} />).container.querySelector('svg')).not.toBeNull()
  const base = path.resolve(__dirname, '../../src/components')
  const used = new Set()
  for (const [dir, file] of [base, path.join(base, 'modern')].flatMap(d => fs.readdirSync(d).filter(f => f.endsWith('.jsx')).map(f => [d, f]))) {
    const source = fs.readFileSync(path.join(dir, file), 'utf8')
    for (const m of source.matchAll(/<Icon name="([a-z-]+)"/g)) used.add(m[1])
    for (const m of source.matchAll(/<Icon name=\{([^}]*)\}/g)) for (const q of m[1].matchAll(/'([a-z-]+)'/g)) used.add(q[1])
    for (const m of source.matchAll(/\bicon: '([a-z-]+)'/g)) used.add(m[1])
  }
  expect(used.size).toBeGreaterThan(10)
  for (const name of used) expect(ICON_NAMES, `icon "${name}" is used but not defined`).toContain(name)
})
