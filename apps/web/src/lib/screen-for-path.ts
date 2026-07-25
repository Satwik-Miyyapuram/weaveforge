import { hasScreenCacheData, isScreenCacheFresh, screenCacheKey } from "./screen-cache";

/** Top-level list screens keyed for {@link useScreenData} cache lookups. */
const ROUTE_SCREENS: readonly { prefix: string; screen: string }[] = [
  { prefix: "/papers", screen: "papers" },
  { prefix: "/notes", screen: "vault" },
  { prefix: "/graph", screen: "graph" },
  { prefix: "/lists", screen: "lists" },
  { prefix: "/experiments", screen: "experiments" },
  { prefix: "/plan", screen: "plan" },
  { prefix: "/log", screen: "logbook" },
  { prefix: "/report", screen: "report" },
  { prefix: "/shared", screen: "shared-with-me" },
];

/** Screen cache id for a pathname, or null for detail/settings routes. */
export function screenForPath(pathname: string): string | null {
  const path = pathname.split(/[?#]/)[0] ?? pathname;
  for (const { prefix, screen } of ROUTE_SCREENS) {
    if (path === prefix) return screen;
    if (path.startsWith(`${prefix}/`)) {
      // e.g. /experiments/:id — detail route, not the list cache.
      return null;
    }
  }
  return null;
}

export function hasFreshScreenCache(pathname: string, projectId: string | null): boolean {
  const screen = screenForPath(pathname);
  if (!screen) return false;
  return isScreenCacheFresh(screenCacheKey(projectId, screen));
}

/** Skip nav overlay when cached data exists (show stale content while revalidating). */
export function hasScreenCacheForPath(pathname: string, projectId: string | null): boolean {
  const screen = screenForPath(pathname);
  if (!screen) return false;
  return hasScreenCacheData(screenCacheKey(projectId, screen));
}
