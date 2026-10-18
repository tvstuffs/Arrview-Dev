import { test, expect } from 'vitest'
import { qualityTier, defaultProfile, profileUsage, usageText, defaultRootFolder, formatFreeSpace } from '../../src/addDefaults.js'

const leaf = (resolution, allowed = true, name = `Q${resolution}`) => ({ quality: { id: resolution, name, resolution }, allowed })
const group = (items, allowed = true) => ({ name: 'Group', allowed, items })
const tier = items => qualityTier({ id: 1, name: 'P', items })

test('tier labels follow the table for every listed range', () => {
  expect(tier([leaf(480)])).toBe('SD')
  expect(tier([leaf(720)])).toBe('HD · 720p')
  expect(tier([leaf(1080)])).toBe('HD · 1080p')
  expect(tier([leaf(720), leaf(1080)])).toBe('HD · 720p–1080p')
  expect(tier([leaf(2160)])).toBe('UHD · 4K')
  expect(tier([leaf(480), leaf(1080)])).toBe('SD to 1080p')
  expect(tier([leaf(480), leaf(2160)])).toBe('SD to 4K')
  expect(tier([leaf(720), leaf(2160)])).toBe('720p to 4K') // gap: no 1080
  expect(tier([leaf(1080), leaf(2160)])).toBe('1080p to 4K')
})

test('nested groups, Remux-only, mixed and the stock Any profile', () => {
  expect(tier([group([leaf(1080, true, 'Remux-1080p')])])).toBe('HD · 1080p')
  expect(tier([group([leaf(480), leaf(720), leaf(1080), leaf(2160)]), leaf(0, true, 'Unknown')])).toBe('SD to 4K')
  expect(tier([group([leaf(1080), leaf(2160)], false)])).toBe('1080p to 4K') // a disallowed group does not hide allowed leaves
})

test('the leaf flag wins over its group flag', () => {
  expect(tier([group([leaf(1080), leaf(2160, false)])])).toBe('HD · 1080p')
  expect(tier([group([leaf(1080, true)], false)])).toBe('HD · 1080p')
  expect(tier([group([leaf(2160, false)])])).toBeNull()
})

// The shape Sonarr and Radarr really send: every single quality carries an empty `items` array
// (checked against both APIs on 2026-10-18; the first 1.9A3 build showed no tier at all because of it).
const apiLeaf = (resolution, allowed = true) => ({ ...leaf(resolution, allowed), items: [] })

test('real API shape: single qualities carry an empty items array', () => {
  expect(tier([apiLeaf(2160)])).toBe('UHD · 4K')
  expect(tier([apiLeaf(0, false), group([apiLeaf(480), apiLeaf(480)]), apiLeaf(2160, false)])).toBe('SD')
  expect(tier([group([apiLeaf(720), apiLeaf(1080)]), apiLeaf(1080), apiLeaf(2160, false)])).toBe('HD · 720p–1080p')
  expect(tier([apiLeaf(480, false), apiLeaf(720, false)])).toBeNull()
})

test('nothing derivable gives no tier', () => {
  expect(qualityTier({ id: 1, name: 'P' })).toBeNull()
  expect(qualityTier({ id: 1, name: 'P', items: [] })).toBeNull()
  expect(qualityTier(null)).toBeNull()
  expect(tier([leaf(0)])).toBeNull()
  expect(tier([{ quality: { name: 'No resolution' }, allowed: true }])).toBeNull()
  expect(tier([leaf('abc')])).toBeNull()
  expect(tier([leaf(480, false)])).toBeNull()
  expect(tier([leaf(480), leaf(720)])).toBeNull() // SD to 720p has no label
})

test('resolution bucket edges', () => {
  expect(tier([leaf(576)])).toBe('SD')
  expect(tier([leaf(577)])).toBe('HD · 720p')
  expect(tier([leaf(720)])).toBe('HD · 720p')
  expect(tier([leaf(721)])).toBe('HD · 1080p')
  expect(tier([leaf(1080)])).toBe('HD · 1080p')
  expect(tier([leaf(1081)])).toBe('UHD · 4K')
  expect(tier([leaf(4320)])).toBe('UHD · 4K')
})

const profiles = [{ id: 1, name: 'A' }, { id: 2, name: 'B' }, { id: 3, name: 'C' }]
const used = ids => ids.map((qualityProfileId, i) => ({ id: i + 1, qualityProfileId }))

test('default profile is the most used one', () => {
  expect(defaultProfile(profiles, used([2, 2, 3, 1])).id).toBe(2)
  expect(profileUsage(2, used([2, 2, 3, 1]))).toBe(2)
  expect(profileUsage(9, used([2]))).toBe(0)
})
test('ties go to the profile listed first; deleted ids are ignored', () => {
  expect(defaultProfile(profiles, used([3, 2, 3, 2])).id).toBe(2)
  expect(defaultProfile(profiles, used([99, 99, 99, 3])).id).toBe(3)
})
test('empty library, no match or no library gives the first profile; no profiles gives null', () => {
  expect(defaultProfile(profiles, []).id).toBe(1)
  expect(defaultProfile(profiles, used([99])).id).toBe(1)
  expect(defaultProfile(profiles, null).id).toBe(1)
  expect(defaultProfile([], used([1]))).toBeNull()
})

test('helper text counts the given profile, with singular and plural nouns', () => {
  expect(usageText(2, used([2, 2, 3]), 'show')).toBe('Used by 2 of your 3 shows')
  expect(usageText(1, used([2, 2, 3]), 'show')).toBe('Used by 0 of your 3 shows')
  expect(usageText(2, used([2]), 'show')).toBe('Used by 1 of your 1 show')
  expect(usageText(2, used([2, 3]), 'movie')).toBe('Used by 1 of your 2 movies')
  expect(usageText(2, used([2]), 'movie')).toBe('Used by 1 of your 1 movie')
  expect(usageText(2, [], 'show')).toBeNull()
  expect(usageText(2, null, 'show')).toBeNull()
})

const folders = [{ path: '/media/tv' }, { path: '/media/tv2' }]
test('default root folder: most used by rootFolderPath', () => {
  const library = [{ rootFolderPath: '/media/tv2' }, { rootFolderPath: '/media/tv2' }, { rootFolderPath: '/media/tv' }]
  expect(defaultRootFolder(folders, library).path).toBe('/media/tv2')
})
test('default root folder: falls back to the path prefix and tolerates trailing slashes', () => {
  expect(defaultRootFolder(folders, [{ path: '/media/tv2/Show' }, { path: '/media/tv2/Other' }, { path: '/media/tv/One' }]).path).toBe('/media/tv2')
  expect(defaultRootFolder([{ path: '/media/tv/' }, { path: '/media/tv2/' }], [{ rootFolderPath: '/media/tv2' }, { path: '/media/tv2/x' }]).path).toBe('/media/tv2/')
  expect(defaultRootFolder(folders, [{ path: 'C:\\media\\tv2\\Show' }]).path).toBe('/media/tv') // different style: no match, first folder
  expect(defaultRootFolder([{ path: 'C:\\media\\tv' }, { path: 'C:\\media\\tv2' }], [{ path: 'C:\\media\\tv2\\Show' }]).path).toBe('C:\\media\\tv2')
})
test('default root folder: path-segment boundaries', () => {
  expect(defaultRootFolder(folders, [{ path: '/media/tv2/Show' }]).path).toBe('/media/tv2') // not /media/tv
  expect(defaultRootFolder(folders, [{ path: '/media/tvshows/X' }, { path: '/media/tvshows/Y' }]).path).toBe('/media/tv') // matches neither: first
  expect(defaultRootFolder(folders, [{ path: '/media/tv' }, { path: '/media/tv' }, { path: '/media/tv2/Show' }]).path).toBe('/media/tv') // exact folder path counts
})
test('default root folder: ties, empty library and empty list', () => {
  expect(defaultRootFolder(folders, [{ rootFolderPath: '/media/tv2' }, { rootFolderPath: '/media/tv' }]).path).toBe('/media/tv')
  expect(defaultRootFolder(folders, []).path).toBe('/media/tv')
  expect(defaultRootFolder(folders, null).path).toBe('/media/tv')
  expect(defaultRootFolder([], [{ path: '/x' }])).toBeNull()
  expect(defaultRootFolder(folders, [{ rootFolderPath: '/gone' }, { rootFolderPath: '/gone' }]).path).toBe('/media/tv') // not in the list
})

test('free space formatting', () => {
  expect(formatFreeSpace(2.1 * 1024 ** 4)).toBe('2.1 TB')
  expect(formatFreeSpace(850 * 1024 ** 3)).toBe('850 GB')
  expect(formatFreeSpace(0)).toBe('0 B')
  expect(formatFreeSpace(512)).toBe('512 B')
  expect(formatFreeSpace(1536)).toBe('1.5 KB')
  expect(formatFreeSpace(12 * 1024 ** 2)).toBe('12 MB')
  expect(formatFreeSpace(5000 * 1024 ** 4)).toBe('5000 TB')
  expect(formatFreeSpace(undefined)).toBeNull()
  expect(formatFreeSpace(null)).toBeNull()
  expect(formatFreeSpace('abc')).toBeNull()
  expect(formatFreeSpace(NaN)).toBeNull()
})
