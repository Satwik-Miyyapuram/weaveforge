import { clearPersistedMcpSessions } from "@/features/ai-assistant/infrastructure/mcp-session-store";
import { stopAllRelays } from "@/features/ai-assistant/infrastructure/mcp-relay-manager";
import { idbClearScreenCaches } from "@/lib/screen-cache-idb";
import { idbClearSearchIndexes } from "@/features/search/infrastructure/search-index-idb";
import { clearPdfTexts } from "@/features/search/infrastructure/pdf-text-store";

function isAppStorageKey(key: string): boolean {
  return key.startsWith("tt:") || key.startsWith("thesis.");
}

/** Drop Cache Storage entries (Serwist runtime + precache) for this origin. */
async function clearServiceWorkerCaches(): Promise<void> {
  if (typeof caches === "undefined") return;
  try {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  } catch {
    /* best-effort */
  }
}

/** Remove all app-local persistence from this browser (sign-out / account delete). */
export async function clearLocalDeviceData(): Promise<void> {
  if (typeof window === "undefined") return;

  // A relay lives outside React so it survives closing the settings modal.
  // It must still stop immediately when the browser's local user context ends.
  stopAllRelays();

  // Storage has no .keys(); snapshot names first (removeItem mutates the store).
  for (const key of Object.keys(sessionStorage)) {
    if (isAppStorageKey(key)) sessionStorage.removeItem(key);
  }

  for (const key of Object.keys(localStorage)) {
    if (isAppStorageKey(key)) localStorage.removeItem(key);
  }

  await clearPersistedMcpSessions();
  await idbClearScreenCaches();
  // The search index holds full note bodies and paper abstracts, so it has to
  // go on sign-out for the same reason the screen caches do.
  await idbClearSearchIndexes();
  await clearPdfTexts();
  await clearServiceWorkerCaches();
}
