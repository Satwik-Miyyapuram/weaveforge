/**
 * Every screen that keeps a `useScreenData` cache, named once.
 *
 * Three lists used to spell these names independently — the route table
 * (`screen-for-path.ts`), the invalidation map (`cache-invalidation-map.ts`) and
 * the prefetch switch (`prefetch-screen.ts`) — and they had already drifted
 * apart in both directions, which is the failure this prevents rather than
 * tidies:
 *
 *   * the invalidation map named `dashboard`, which no screen caches (the
 *     dashboard has its own facade), and `notes`, which is the vault's route —
 *     so every write deleted two dozen cache keys that were never written;
 *   * `/report/overleaf` is a real route with a real cache key, and it was in
 *     none of the three, so hovering its tab warmed nothing and navigating to it
 *     skipped the nav overlay.
 *
 * The list is seeded from the `useScreenData` call sites, because that call is
 * the only thing that creates a screen cache: a name no screen passes is a name
 * nothing writes, and a name a screen passes but this list lacks is a cache that
 * is never cleared on a write or warmed on a hover.
 */

export const SCREEN_IDS = [
  "papers",
  "vault",
  "graph",
  "lists",
  "experiments",
  "plan",
  "logbook",
  "report",
  "report-overleaf",
  "shared-with-me",
] as const;

export type ScreenId = (typeof SCREEN_IDS)[number];
