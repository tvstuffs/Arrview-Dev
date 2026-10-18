// Defaults for the Add sheet, computed in the browser from data the page already holds.
// ArrView stores nothing: the picked profile and folder are sent with the add.

const BUCKET_ORDER = ['SD', '720', '1080', '2160']

function bucketOf(resolution) {
  if (!Number.isFinite(resolution) || resolution <= 0) return null
  if (resolution <= 576) return 'SD'
  if (resolution <= 720) return '720'
  if (resolution <= 1080) return '1080'
  return '2160'
}

function collectBuckets(items, found) {
  if (!Array.isArray(items)) return
  for (const entry of items) {
    if (!entry || typeof entry !== 'object') continue
    // Groups are containers only. Sonarr and Radarr also send every single quality with `items: []`,
    // so only a non-empty list marks a group.
    if (Array.isArray(entry.items) && entry.items.length > 0) collectBuckets(entry.items, found)
    else if (entry.quality && typeof entry.quality === 'object' && entry.allowed === true) {
      const bucket = bucketOf(Number(entry.quality.resolution))
      if (bucket) found.add(bucket)
    }
  }
}

const TIER_LABELS = {
  'SD|SD': 'SD',
  '720|720': 'HD · 720p',
  '1080|1080': 'HD · 1080p',
  '720|1080': 'HD · 720p–1080p',
  '2160|2160': 'UHD · 4K',
  'SD|1080': 'SD to 1080p',
  'SD|2160': 'SD to 4K',
  '720|2160': '720p to 4K',
  '1080|2160': '1080p to 4K',
}

// Named tier from the allowed leaf qualities of a profile, or null when nothing can be derived.
export function qualityTier(profile) {
  const found = new Set()
  collectBuckets(profile?.items, found)
  if (found.size === 0) return null
  const ordered = BUCKET_ORDER.filter(bucket => found.has(bucket))
  return TIER_LABELS[`${ordered[0]}|${ordered[ordered.length - 1]}`] ?? null
}

// How many library items use this profile id.
export function profileUsage(profileId, library) {
  if (!Array.isArray(library)) return 0
  return library.filter(item => item && Number(item.qualityProfileId) === Number(profileId)).length
}

// The profile most of the library uses; ties go to the earlier profile, no match to the first profile.
export function defaultProfile(profiles, library) {
  if (!Array.isArray(profiles) || profiles.length === 0) return null
  let best = profiles[0], bestCount = -1
  for (const profile of profiles) {
    const count = profileUsage(profile.id, library)
    if (count > bestCount) { best = profile; bestCount = count }
  }
  return best
}

// "Used by N of your M shows", or null when there is no library to count.
export function usageText(profileId, library, type) {
  if (!Array.isArray(library) || library.length === 0) return null
  const noun = type === 'show' ? 'show' : 'movie'
  const total = library.length
  return `Used by ${profileUsage(profileId, library)} of your ${total} ${noun}${total === 1 ? '' : 's'}`
}

const trimSlashes = path => String(path ?? '').replace(/[\\/]+$/, '')

// Root folder of a library item: its own rootFolderPath, else the longest listed folder that contains its path.
function folderOf(item, folders) {
  if (item.rootFolderPath) return trimSlashes(item.rootFolderPath)
  const itemPath = trimSlashes(item.path)
  if (!itemPath) return null
  let match = null
  for (const folder of folders) {
    const base = trimSlashes(folder.path)
    if (!base) continue
    const inside = itemPath === base || (itemPath.startsWith(base) && (itemPath[base.length] === '/' || itemPath[base.length] === '\\'))
    if (inside && (!match || base.length > match.length)) match = base
  }
  return match
}

export function defaultRootFolder(folders, library) {
  if (!Array.isArray(folders) || folders.length === 0) return null
  const counts = new Map()
  if (Array.isArray(library)) {
    for (const item of library) {
      if (!item) continue
      const folder = folderOf(item, folders)
      if (folder !== null) counts.set(folder, (counts.get(folder) ?? 0) + 1)
    }
  }
  let best = folders[0], bestCount = -1
  for (const folder of folders) {
    const count = counts.get(trimSlashes(folder.path)) ?? 0
    if (count > bestCount) { best = folder; bestCount = count }
  }
  return best
}

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB']

// Base-1024 size with one decimal below 10, none otherwise; null when the value is missing or not a number.
export function formatFreeSpace(bytes) {
  if (bytes === null || bytes === undefined || bytes === '' || typeof bytes === 'boolean') return null
  let value = Number(bytes)
  if (!Number.isFinite(value) || value < 0) return null
  let unit = 0
  while (value >= 1024 && unit < UNITS.length - 1) { value /= 1024; unit++ }
  const text = value < 10 && unit > 0 ? value.toFixed(1) : String(Math.round(value))
  return `${text} ${UNITS[unit]}`
}
