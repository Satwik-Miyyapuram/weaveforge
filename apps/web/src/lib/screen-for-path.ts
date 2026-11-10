import { hasScreenCacheData, screenCacheKey } from "@/lib/cache/screen-cache";
import type { ScreenId } from "@/lib/screens";
import { readyCore } from "@/lib/rust-core";

/** Skip nav overlay when cached data exists (show stale content while revalidating). */
export function hasScreenCacheForPath(pathname: string, projectId: string | null): boolean {
  const screen = (readyCore().screenForPath(pathname) ?? null) as ScreenId | null;
  if (!screen) return false;
  return hasScreenCacheData(screenCacheKey(projectId, screen));
}
