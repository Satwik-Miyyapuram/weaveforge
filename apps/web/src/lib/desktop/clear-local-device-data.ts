import { loadCore } from "@/lib/rust-core";
import { clearPersistedMcpSessions } from "@/features/ai-assistant/infrastructure/mcp-session-store";
import { stopAllRelays } from "@/features/ai-assistant/infrastructure/mcp-relay-manager";
import { closeAppDb } from "@/lib/cache/parts-1";
import { clearCacheStorage } from "@/lib/parts";
import { idbClearScreenCaches } from "@/lib/cache/parts-2";
import { idbClearSearchIndexes, idbClearVectors } from "@/features/search/infrastructure/parts-3";
import { clearPdfTexts } from "@/features/search/infrastructure/parts-2";
import { PAPER_HTML_DB_NAME, PDF_CACHE_DB_NAME } from "@/features/reader/infrastructure/parts-1";

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

/** Remove all app-local persistence from this browser (sign-out / account delete). */
export async function clearLocalDeviceData(): Promise<void> {
  if (typeof window === "undefined") return;
  // Taken before the first await: the wipe covers the storage that existed when sign-out ran,
  // not whatever the global holds once the Rust core has loaded.
  const session = sessionStorage;
  const local = localStorage;
  // Which keys are account state is decided in Rust (`wf_core::app_lib::storage_keys`).
  const core = await loadCore();

  // A relay lives outside React so it survives closing the settings modal.
  // It must still stop immediately when the browser's local user context ends.
  stopAllRelays();

  // Storage has no .keys(); snapshot names first (removeItem mutates the store).
  for (const key of Object.keys(session)) {
    if (core.isAppStorageKey(key)) session.removeItem(key);
  }

  for (const key of Object.keys(local)) {
    if (core.isAppStorageKey(key)) local.removeItem(key);
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
  await clearCacheStorage();
  // Last, and deliberately: every clear above opens its transaction through this
  // same connection. Closing before them would have the next one reopen it, so
  // the wipe would end holding a live handle on the database it just emptied.
  closeAppDb();
}
