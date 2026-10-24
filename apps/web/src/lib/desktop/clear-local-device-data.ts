import { clearPersistedMcpSessions } from "@/features/ai-assistant/infrastructure/mcp-session-store";
import { stopAllRelays } from "@/features/ai-assistant/infrastructure/mcp-relay-manager";
import { closeAppDb } from "@/lib/cache/app-idb";
import { idbClearScreenCaches } from "@/lib/cache/screen-cache-idb";
import { idbClearSearchIndexes } from "@/features/search/infrastructure/search-index-idb";
import { clearPdfTexts } from "@/features/search/infrastructure/pdf-text-store";
import { idbClearVectors } from "@/features/search/infrastructure/vector-store-idb";
import { PAPER_HTML_DB_NAME, PDF_CACHE_DB_NAME } from "@/features/reader/infrastructure/local-cache-names";

/**
 * `weaveforge.` and `wf.` keys that describe this device, not the account:
 * how the pen and reader behave, and whether the window runs without an
 * account. `weaveforge.local-first` names which account owns this machine's
 * database; sign-out resets it itself, and dropping it on any other user change
 * would let the next account adopt the last one's database.
 */
const DEVICE_KEYS = new Set(["weaveforge.local-mode", "weaveforge.local-first"]);
const DEVICE_PREFIXES = ["weaveforge.ink.", "weaveforge.reader.", "weaveforge.md.", "wf.ink.", "wf.reader."];

/** Keys holding account or workspace state. New keys are wiped unless listed above. */
function isAppStorageKey(key: string): boolean {
  if (key.startsWith("tt:") || key.startsWith("thesis.")) return true;
  if (!key.startsWith("weaveforge.") && !key.startsWith("wf.")) return false;
  return !DEVICE_KEYS.has(key) && !DEVICE_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/** Best-effort: a blocked delete still completes once the last handle closes. */
function deleteDatabase(name: string): Promise<void> {
  if (typeof indexedDB === "undefined") return Promise.resolve();
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
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
  // Vectors encode the text they were built from; leaving them is leaving the
  // workspace's content on a device the next person may be using.
  await idbClearVectors();
  // Downloaded PDFs and saved paper HTML are the papers themselves.
  await deleteDatabase(PDF_CACHE_DB_NAME);
  await deleteDatabase(PAPER_HTML_DB_NAME);
  await clearServiceWorkerCaches();
  // Last, and deliberately: every clear above opens its transaction through this
  // same connection. Closing before them would have the next one reopen it, so
  // the wipe would end holding a live handle on the database it just emptied.
  closeAppDb();
}
