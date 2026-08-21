import { invalidateAllRepoCaches } from "@/lib/cache/project-lww-invalidator";
import { clearAllScreenCaches } from "@/lib/cache/screen-cache";
import { clearLocalDeviceData } from "@/lib/desktop/clear-local-device-data";

let clearDashboardUiCaches: () => void = () => {};
const sessionResetHooks: Array<() => void> = [];

/** Register module-level dashboard caches to clear on logout. */
export function registerDashboardUiCacheClear(fn: () => void): void {
  clearDashboardUiCaches = fn;
}

/** Register hooks that reset session-scoped app state (project selection, crypto, etc.). */
export function registerSessionReset(fn: () => void): void {
  sessionResetHooks.push(fn);
}

/** Drop in-memory caches and wipe browser persistence so the next user starts clean. */
export function clearSessionCaches(): void {
  invalidateAllRepoCaches();
  clearAllScreenCaches();
  clearDashboardUiCaches();
  clearStartupSnapshotCache();
  for (const reset of sessionResetHooks) reset();
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
