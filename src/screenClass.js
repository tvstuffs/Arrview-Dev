import SCREEN from './screenClass.json'

// The screen class: layout follows width, height, safe areas and pointer only (no device or user-agent checks).
// Width: compact below `compactBelow`. Height: short below `shortBelow`, measured on the large viewport height (100lvh), so
// Safari's toolbar moving while the page scrolls never flips it. A side-controls column is an inset of at least `columnMin`
// on one side with less than `columnOtherMax` on the other (some foldables keep the system's own controls there).
export { SCREEN }

const NO_INSETS = { top: 0, right: 0, bottom: 0, left: 0 }
const SIDES = ['top', 'right', 'bottom', 'left']

export function columnSide(insets = NO_INSETS, options = SCREEN) {
  const { left = 0, right = 0 } = insets
  if (right >= options.columnMin && left < options.columnOtherMax) return 'right'
  if (left >= options.columnMin && right < options.columnOtherMax) return 'left'
  return null
}

//  height   width    column  pointer                 nav
//  regular  compact  any     any                     bottom (the phone bar)
//  regular  regular  any     any                     top (the top bar)
//  short    any      yes     any                     rail on the column's side, placement from `railPlacement`
//  short    regular  no      coarse                  rail at the left, beside any inset
//  short    compact  no      coarse, wider than tall rail at the left, beside any inset
//  short    regular  no      fine                    top, with condensed page headers
//  short    compact  no      otherwise               bottom-compact
// `railStyle` ("ios" two pills, or "labelled") applies only to a rail inside a column; any other rail is labelled.
export function classifyScreen({ width, height, insets = NO_INSETS, coarse = false }, overrides = {}) {
  const o = { ...SCREEN, ...overrides }
  const compact = width < o.compactBelow
  const short = height < o.shortBelow
  const column = columnSide(insets, o)
  let nav, railSide = null, railPlacement = null
  if (!short) nav = compact ? 'bottom' : 'top'
  else if (column) { nav = 'rail'; railSide = column; railPlacement = o.railPlacement }
  else if (coarse && (!compact || width > height)) { nav = 'rail'; railSide = 'left'; railPlacement = 'beside' }
  else nav = compact ? 'bottom-compact' : 'top'
  const rail = nav === 'rail'
  return {
    width: compact ? 'compact' : 'regular', height: short ? 'short' : 'regular', column, nav, railSide, railPlacement,
    railAnchor: rail ? o.railAnchor : null,
    railStyle: rail ? (column && railPlacement === 'inside' ? o.railStyle : 'labelled') : null,
    iconsOnly: height < o.iconsOnlyBelow,
  }
}

// The status-cluster keep-out at the top of a column: a share of the (large) height, shrunk so the rail fits below it.
// "ios": the tab pill ends `bottomMargin` above the viewport bottom and the top pill (Back on detail pages, then Settings)
// sits at least a gap above it; never below the minimum. "labelled": the single rail group fits above --sa-bottom.
export function keepOutFor({ height, insets = NO_INSETS, style = 'labelled', tabs = 5, detail = false }, overrides = {}) {
  const o = { ...SCREEN, ...overrides }
  const tight = height < o.iconsOnlyBelow
  const ratio = Math.round(o.statusKeepOutRatio * height)
  if (style === 'ios') {
    const k = o.ios, pitch = tight ? k.pitchTight : k.pitch, pad = tight ? k.padTight : k.pad, gap = tight ? k.gapTight : k.gap
    const tabTop = height - k.bottomMargin - (tabs * pitch + 2 * pad)
    const fit = tabTop - gap - ((detail ? 2 : 1) * pitch + 2 * pad)
    return Math.max(o.statusKeepOutMin, Math.min(ratio, fit))
  }
  const k = o.labelled, items = tabs + 1
  const stack = items * (tight ? k.itemIconsOnly : k.item) + (items - 1) * k.gap
  const room = height - (insets.bottom || 0) - k.pad - stack
  return Math.max(0, Math.min(Math.max(o.statusKeepOutMin, ratio), room))
}

const pxValue = value => {
  const match = /^(-?\d*\.?\d+)px$/.exec(String(value ?? '').trim())
  return match ? Number(match[1]) : 0
}
const styleOf = (el, env) => (env && env.getComputedStyle ? env.getComputedStyle(el) : window.getComputedStyle(el))

// The four insets from the probe's padding (var(--sa-*)), so an inline --sa-* override reaches the hook as it reaches CSS.
export function readInsets(el, env) {
  if (!el) return { ...NO_INSETS }
  const style = styleOf(el, env)
  return Object.fromEntries(SIDES.map(side => [side, pxValue(style[`padding${side[0].toUpperCase()}${side.slice(1)}`])]))
}

// The large viewport height from the probe (height: 100lvh), or innerHeight where lvh is unsupported or unreadable.
export function readLargeHeight(el, fallback, env = {}) {
  const supports = 'supportsLvh' in env ? env.supportsLvh
    : typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('height', '100lvh')
  if (!el || !supports) return fallback
  const height = pxValue(styleOf(el, env).height)
  return height > 0 ? height : fallback
}
