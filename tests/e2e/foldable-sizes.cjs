// Full-viewport size matrix for the foldables group (plan section 8, amended by the maintainer's Phase 0 note). CSS px.
//
// Every value a Phase 0 measurement can change lives here and in src/screenClass.json, nowhere else.
// `source` says how sure each entry is:
//   measured     measured on the device with the Phase 0 probe (Safari), or read from the simulator or Apple;
//   estimate     derived (a spec sheet and a guessed pixel ratio, or a Split View width before Safari applied its column);
//   provisional  read from screenshots; not yet measured on the device (the keyboard on the cover upright and open wide).
// Maintainer notes 1 and 3 (2026-11-22) supplied the measured values; the keep-out is in src/screenClass.json.
// `insets` are emulated by setting --sa-top/right/bottom/left inline on <html>; a missing side is 0.
// `large` is the large viewport height the device reports (100lvh) where it differs from the viewport height. Chromium has
// no dynamic toolbar, so the tests run at `height` (its 100lvh equals the viewport height); the unit tests cover `large`.
// `touch` entries run with hasTouch + isMobile (coarse pointer); the others with a mouse (fine pointer).
// `twoRows` sizes must show two full rows of large posters at scroll 0 (spec criterion 23).
// `shots` sizes are in the before/after contact sheets.

const SIZES = [
  { id: 'duo-cover', width: 461, height: 678, insets: { right: 84, bottom: 34 }, touch: true, source: 'measured', what: 'Duo cover upright, Home Screen', twoRows: true, shots: true },
  { id: 'duo-cover-sim', width: 466, height: 678, insets: { right: 84, bottom: 34 }, touch: true, source: 'provisional', what: 'Duo cover, Home Screen, simulator width (insets provisional)', twoRows: true, shots: true },
  { id: 'duo-cover-safari', width: 377, height: 580, large: 618, insets: {}, touch: true, source: 'measured', what: 'Duo cover upright, Safari', shots: true },
  { id: 'duo-cover-land-safari', width: 594, height: 363, large: 401, insets: {}, touch: true, source: 'measured', what: 'Duo cover sideways, Safari: rail at the left', shots: true },
  { id: 'duo-cover-land-left', width: 678, height: 461, insets: { left: 84, bottom: 34 }, touch: true, source: 'measured', what: 'Duo cover sideways (landscape-primary, angle 90), Home Screen, column on the left', shots: true },
  { id: 'duo-cover-land-right', width: 678, height: 461, insets: { right: 84, bottom: 34 }, touch: true, source: 'measured', what: 'Duo cover sideways (landscape-secondary, angle 270), Home Screen, column on the right', shots: true },
  { id: 'duo-inner-land', width: 951, height: 669, insets: { right: 84, bottom: 34 }, touch: true, source: 'measured', what: 'Duo open wide (angle 270), Home Screen', twoRows: true, shots: true },
  { id: 'duo-inner-land-safari', width: 951, height: 537, large: 620, insets: { bottom: 34 }, touch: true, source: 'measured', what: 'Duo inner open wide, Safari with a tab strip: rail at the left', shots: true },
  { id: 'duo-inner-port', width: 669, height: 951, insets: { top: 82, bottom: 34 }, touch: true, source: 'measured', what: 'Duo open tall, Home Screen: top bar, clear of the 82 px top inset', shots: true },
  { id: 'duo-inner-port-safari', width: 669, height: 819, large: 902, insets: { bottom: 34 }, touch: true, source: 'measured', what: 'Duo inner open tall, Safari with a tab strip: top bar, unchanged', shots: true },
  { id: 'duo-split', width: 385, height: 571, large: 609, insets: {}, touch: true, source: 'measured', what: 'one Duo Split View window, Safari, either side', shots: true },
  { id: 'duo-split-home-right', width: 469, height: 669, insets: { right: 84, bottom: 34 }, touch: true, source: 'measured', what: 'Duo Split View, Home Screen, the window beside the column', shots: true },
  { id: 'duo-split-home-away', width: 469, height: 669, insets: { bottom: 34 }, touch: true, source: 'measured', what: 'Duo Split View, Home Screen, the other window (no side inset)', shots: true },
  { id: 'duo-split-home-left', width: 469, height: 669, insets: { left: 84, bottom: 34 }, touch: true, source: 'estimate', what: 'Duo Split View, Home Screen, the inner screen turned the other way round (angle 90; not measured)', shots: true },
  { id: 'fold8-cover-small', width: 412, height: 600, insets: {}, touch: true, source: 'estimate', what: 'Galaxy Z Fold8 cover, Chrome (lower bracket)' },
  { id: 'fold8-cover-large', width: 475, height: 690, insets: {}, touch: true, source: 'estimate', what: 'Galaxy Z Fold8 cover, Chrome (upper bracket)' },
  { id: 'fold8-inner-small', width: 816, height: 560, insets: {}, touch: true, source: 'estimate', what: 'Galaxy Z Fold8 inner, Chrome (lower bracket)' },
  { id: 'fold8-inner-large', width: 933, height: 640, insets: {}, touch: true, source: 'estimate', what: 'Galaxy Z Fold8 inner, Chrome (upper bracket)' },
  { id: 'iphone-se', width: 375, height: 667, insets: {}, touch: true, source: 'measured', what: 'iPhone SE: short, compact bottom bar (intended change)' },
  { id: 'iphone-landscape', width: 874, height: 402, insets: { left: 62, right: 62, bottom: 21 }, touch: true, source: 'estimate', what: 'iPhone 17 Pro in landscape: short, left rail (approximate insets)' },
  { id: 'desktop-short', width: 1280, height: 600, insets: {}, touch: false, source: 'measured', what: 'short desktop window, fine pointer: top bar and condensed headers' },
]
// Regular-height anchors: no rail, bars as at acf02d6 (spec criterion 33, assertion 8).
const REGRESSION = [
  { id: 'iphone-17-pro', width: 402, height: 874, insets: { top: 62, bottom: 34 }, touch: true, source: 'estimate', what: 'iPhone portrait (approximate insets)', shots: true },
  { id: 'iphone-17-pro-max', width: 440, height: 956, insets: { top: 62, bottom: 34 }, touch: true, source: 'estimate', what: 'iPhone Pro Max portrait (approximate insets)', shots: true },
  { id: 'iphone-safari', width: 402, height: 752, insets: {}, touch: true, source: 'estimate', what: 'iPhone 17 Pro in Safari, toolbar hidden', shots: true },
  { id: 'iphone-safari-small', width: 390, height: 737, insets: {}, touch: true, source: 'estimate', what: 'a 390 px iPhone in Safari, toolbar hidden', shots: true },
  { id: 'ipad-portrait', width: 834, height: 1194, insets: {}, touch: true, source: 'measured', what: 'iPad portrait', shots: true },
  { id: 'ipad-mini-landscape', width: 1133, height: 744, insets: {}, touch: true, source: 'measured', what: 'iPad mini landscape', shots: true },
  { id: 'desktop', width: 1280, height: 800, insets: {}, touch: false, source: 'measured', what: 'desktop', shots: true },
  { id: 'desktop-large', width: 1440, height: 900, insets: {}, touch: false, source: 'measured', what: 'large desktop', shots: true },
]
// What the keyboard leaves of the screen. `full` is the screen it comes from: the keyboard changes neither innerHeight nor
// the large height on the Duo (Phase 0), only the visual viewport, so each entry runs twice: once with the whole viewport cut
// down to the size (the spec's literal emulation) and once at `full` with window.visualViewport reporting the size.
const KEYBOARD = [
  { id: 'duo-cover-keyboard', width: 461, height: 356, full: { width: 461, height: 678 }, insets: { right: 84 }, fullInsets: { right: 84, bottom: 34 }, touch: true, source: 'provisional', what: 'Duo cover, Home Screen, keyboard up (IMG_0057)' },
  { id: 'duo-inner-keyboard', width: 951, height: 366, full: { width: 951, height: 669 }, insets: { right: 84 }, fullInsets: { right: 84, bottom: 34 }, touch: true, source: 'provisional', what: 'Duo inner in landscape, Home Screen, keyboard up (IMG_0059)' },
  { id: 'duo-cover-safari-keyboard', width: 377, height: 311, full: { width: 377, height: 580 }, insets: {}, fullInsets: {}, touch: true, source: 'measured', what: 'Duo cover upright, Safari, keyboard up' },
  { id: 'duo-inner-safari-keyboard', width: 951, height: 307, full: { width: 951, height: 537 }, insets: {}, fullInsets: { bottom: 34 }, touch: true, source: 'measured', what: 'Duo inner open wide, Safari, keyboard up' },
  // Home Screen, measured (maintainer note 3): with a sheet's field focused iOS also scrolls the visual viewport (offsetTop).
  { id: 'duo-cover-land-keyboard', width: 678, height: 200, offsetTop: 94, full: { width: 678, height: 461 }, insets: { right: 84 }, fullInsets: { right: 84, bottom: 34 }, touch: true, source: 'measured', what: 'Duo cover sideways, column on the right, Home Screen, keyboard up' },
  { id: 'duo-split-keyboard', width: 469, height: 360, offsetTop: 121, full: { width: 469, height: 669 }, insets: {}, fullInsets: { bottom: 34 }, touch: true, source: 'measured', what: 'Duo Split View, the window without a column, Home Screen, keyboard up' },
  { id: 'duo-split-keyboard-low', width: 469, height: 323, offsetTop: 121, full: { width: 469, height: 669 }, insets: {}, fullInsets: { bottom: 34 }, touch: true, source: 'measured', what: 'Duo Split View, the window without a column, Home Screen, keyboard up (lower reading)' },
]
// What the screen class must come out as at each size (spec criterion 5 as amended: short below 700 px of large height; a
// coarse pointer on a short screen wider than tall gets the left rail). `column` is the side of a side-controls column.
const EXPECTED = {
  'duo-cover': ['short', 'rail', 'right'], 'duo-cover-sim': ['short', 'rail', 'right'],
  'duo-cover-safari': ['short', 'bottom-compact', null], 'duo-cover-land-safari': ['short', 'rail', null],
  'duo-cover-land-right': ['short', 'rail', 'right'], 'duo-cover-land-left': ['short', 'rail', 'left'],
  'duo-inner-land': ['short', 'rail', 'right'], 'duo-split-home-away': ['short', 'bottom-compact', null],
  'duo-inner-land-safari': ['short', 'rail', null], 'duo-inner-port': ['regular', 'top', null],
  'duo-inner-port-safari': ['regular', 'top', null], 'duo-split': ['short', 'bottom-compact', null],
  'duo-split-home-right': ['short', 'rail', 'right'], 'duo-split-home-left': ['short', 'rail', 'left'],
  'fold8-cover-small': ['short', 'bottom-compact', null], 'fold8-cover-large': ['short', 'bottom-compact', null],
  'fold8-inner-small': ['short', 'rail', null], 'fold8-inner-large': ['short', 'rail', null],
  'iphone-se': ['short', 'bottom-compact', null], 'iphone-landscape': ['short', 'rail', null],
  'desktop-short': ['short', 'top', null],
}
for (const size of SIZES) {
  const [height, nav, column] = EXPECTED[size.id]
  Object.assign(size, { expected: { height, nav, column } })
}
for (const size of REGRESSION) Object.assign(size, { expected: { height: 'regular', nav: size.width < 640 ? 'bottom' : 'top', column: null } })

// The fold sequence of spec criterion 31: cover, inner, cover.
const byId = id => SIZES.find(size => size.id === id)
const FOLD = { cover: byId('duo-cover'), inner: byId('duo-inner-land') }

const inset = (size, side) => (size.insets && size.insets[side]) || 0
module.exports = { SIZES, REGRESSION, KEYBOARD, FOLD, inset, byId }
