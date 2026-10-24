import { invalidateAllRepoCaches } from "@/lib/cache/project-lww-invalidator";
import { clearBlobFetchCache } from "@/lib/cache/blob-fetch-cache";
import { clearLocalDeviceData } from "@/lib/desktop/clear-local-device-data";
import { logToApp } from "@/lib/error-report/app-log";
import { formatError } from "@/lib/format-error";

const sessionResetHooks: Array<() => void> = [];

/**
 * Register a module-level dashboard cache to clear on logout. Two modules call
 * this; it kept one slot, so the first registration was lost and its cache
 * outlived the account. It is now an ordinary reset hook.
 */
export function registerDashboardUiCacheClear(fn: () => void): () => void {
  return registerSessionReset(fn);
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
  // Screen caches are cleared inside `invalidateAllRepoCaches`.
  invalidateAllRepoCaches();
  clearBlobFetchCache();
  // A copy, so a hook that disposes itself is not mutating the list being walked.
  // One failing hook must not leave the ones after it holding the last user's data.
  for (const reset of [...sessionResetHooks]) {
    try {
      reset();
    } catch (err) {
      logToApp({ level: "warn", source: "session", message: "A sign-out reset failed.", detail: formatError(err) });
    }
  }
  // Removes every `thesis.*` key, the startup snapshots among them.
  void clearLocalDeviceData();
}
