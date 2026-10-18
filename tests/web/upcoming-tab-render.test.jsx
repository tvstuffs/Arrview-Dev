import React from 'react'
import { test, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const episode = firstEpisode => ({
  key: 'ep-1', kind: 'episode', dayKey: '2026-10-18', at: Date.UTC(2026, 9, 18, 12), seriesId: 1, movieId: null,
  title: 'Some Show', season: 1, seasons: [1], episodeNumbers: [2], count: 1, done: 0, subtitle: '',
  status: null, series: { id: 1, title: 'Some Show' }, movie: null, firstEpisode,
})
let entries = []
vi.mock('../../src/hooks/useUpcoming', () => ({
  default: () => ({ entries, loading: false, errors: {}, retry: () => {} }),
}))
const UpcomingTab = (await import('../../src/components/UpcomingTab')).default

test('single episode without a title never renders "undefined"', () => {
  entries = [episode({ id: 10, seasonNumber: 1, episodeNumber: 2 })]
  const { container } = render(<UpcomingTab config={{}} />)
  expect(screen.getByText('S01E02')).toBeTruthy()
  expect(container.textContent).not.toContain('undefined')
})

test('single episode with a title shows " · title"', () => {
  entries = [episode({ id: 10, title: 'Pilot' })]
  render(<UpcomingTab config={{}} />)
  expect(screen.getByText('S01E02 · Pilot')).toBeTruthy()
})
