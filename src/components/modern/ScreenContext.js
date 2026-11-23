import { createContext, useContext } from 'react'

// The shell's screen class for the Modern pages (see useScreenClass). Pages rendered without the shell get today's
// regular-height layout. `settingsInRail`: the rail carries Settings, so pages drop their own gear. `backInRail`: the ios
// rail's top pill carries Back, so detail pages drop their round Back and Settings buttons.
export const REGULAR_SCREEN = { width: 'regular', height: 'regular', nav: 'top', railSide: null, railStyle: null, iconsOnly: false, settingsInRail: false, backInRail: false }
export const ScreenContext = createContext(REGULAR_SCREEN)
export const useScreen = () => useContext(ScreenContext)
