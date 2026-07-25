/**
 * App-wide mobile ↔ desktop layout breakpoint.
 * Keep in sync with `@media (min-width: 900px)` in globals.css (nav sidebar, shell).
 */
export const DESKTOP_BREAKPOINT_PX = 900;

/** Use in CSS as `max-width: 899px` for mobile-only rules. */
export const MOBILE_MAX_BREAKPOINT_PX = DESKTOP_BREAKPOINT_PX - 1;
