import { hasScreenCacheData, screenCacheKey } from "@/lib/cache/screen-cache";

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

/**
 * The route table, as a lookup.
 *
 * Every navigation asks this — and so does every cache lookup behind it — and
 * the dominant case is a path that is exactly a list route. That case is now a
 * map hit rather than a regex split plus a linear scan of nine prefixes.
 */
const EXACT_SCREENS = new Map(ROUTE_SCREENS.map(({ prefix, screen }) => [prefix, screen]));

/** Screen cache id for a pathname, or null for detail/settings routes. */
export function screenForPath(pathname: string): string | null {
  // Cut the query and fragment without allocating an array, let alone running a
  // regex: `indexOf` answers it, and `-1` means "not there".
  const query = pathname.indexOf("?");
  const hash = pathname.indexOf("#");
  const cut = query < 0 ? hash : hash < 0 ? query : Math.min(query, hash);
  const path = cut < 0 ? pathname : pathname.slice(0, cut);

  const exact = EXACT_SCREENS.get(path);
  if (exact) return exact;

  for (const { prefix } of ROUTE_SCREENS) {
    // e.g. /experiments/:id — a detail route, not the list cache. Caching one
    // run's page under the list's key would paint the list instead.
    if (path.startsWith(`${prefix}/`)) return null;
  }
  return null;
}

/** Skip nav overlay when cached data exists (show stale content while revalidating). */
export function hasScreenCacheForPath(pathname: string, projectId: string | null): boolean {
  const screen = screenForPath(pathname);
  if (!screen) return false;
  return hasScreenCacheData(screenCacheKey(projectId, screen));
}
