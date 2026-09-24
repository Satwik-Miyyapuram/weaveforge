/**
 * App-wide mobile ↔ desktop layout breakpoint.
 * Keep in sync with `@media (min-width: 900px)` in styles/nav.css (nav sidebar, shell).
 */
export const DESKTOP_BREAKPOINT_PX = 900;

/**
 * Below this width the desktop sidebar *starts* collapsed, as the icon rail.
 *
 * The 216px sidebar earns its width when there is room for it. Between the 900px
 * layout breakpoint and here there is not: measured on the installed app, a
 * 900px window left a 596px content column and a 960px one 651px, against 1200px
 * on a wide display — and both of those widths are real tablets in landscape.
 *
 * The rail is not a new layout: it is the state `/workspace` already opens in and
 * the hamburger already toggles (`.layout.nav-collapsed`, nav.css). This only
 * changes which state a tablet-sized window *starts* in, and expanding it again
 * is one tap.
 *
 * Keep in sync with the media query in `hooks/use-layout-breakpoint.ts`.
 */
export const RAIL_COLLAPSE_BELOW_PX = 1100;
