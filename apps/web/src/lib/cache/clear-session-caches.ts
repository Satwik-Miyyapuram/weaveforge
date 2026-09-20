import { invalidateAllRepoCaches } from "@/lib/cache/project-lww-invalidator";
import { clearAllScreenCaches } from "@/lib/cache/screen-cache";
import { clearLocalDeviceData } from "@/lib/desktop/clear-local-device-data";

let clearDashboardUiCaches: () => void = () => {};
const sessionResetHooks: Array<() => void> = [];

/** Register module-level dashboard caches to clear on logout. */
export function registerDashboardUiCacheClear(fn: () => void): void {
  clearDashboardUiCaches = fn;
}

/**
 * Hooks that reset session-scoped state, and the way to take one back.
 *
 * The list was push-only. `createAppContainer()` registers one reset hook, and
 * `bootstrap.ts` rebuilds the container whenever the backend or storage provider
 * changes — so after a few rebuilds a single sign-out ran every generation's
 * hook, each one holding the previous container's project context, workspace
 * facade and closures alive. Returning a disposer is what lets a container take
 * its own hook with it.
 */
export function registerSessionReset(fn: () => void): () => void {
  sessionResetHooks.push(fn);
  return () => {
    // By value, not by a captured index: an earlier hook may have been removed
    // in between, and `splice(index)` would then take out the wrong one.
    const index = sessionResetHooks.indexOf(fn);
    if (index >= 0) sessionResetHooks.splice(index, 1);
  };
}

/** Drop in-memory caches and wipe browser persistence so the next user starts clean. */
export function clearSessionCaches(): void {
  invalidateAllRepoCaches();
  clearAllScreenCaches();
  clearDashboardUiCaches();
  clearStartupSnapshotCache();
  // A copy, so a hook that disposes itself is not mutating the list being walked.
  for (const reset of [...sessionResetHooks]) reset();
  void clearLocalDeviceData();
}

/** Remove the cached startup snapshots (org/profile/settings) so nothing persists after sign-out. */
function clearStartupSnapshotCache(): void {
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith("thesis.startup.")) localStorage.removeItem(key);
    }
  } catch {
    /* best-effort */
  }
}
