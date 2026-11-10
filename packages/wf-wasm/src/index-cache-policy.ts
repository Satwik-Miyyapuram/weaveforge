/**
 * Index persistence rule (Rust `index_cache_policy`). The caller supplies whether
 * this is the installed app; platform detection stays in the app.
 */
import {
  shouldPersistIndex as rawShouldPersistIndex,
  webCacheDocumentLimit as rawWebCacheDocumentLimit,
} from "../pkg/wf_wasm.js";

/** True when the index should be written to storage. */
export function shouldPersistIndex(installedApp: boolean, documentCount: number): boolean {
  return rawShouldPersistIndex(installedApp, documentCount);
}

/** Documents past which a browser tab stops persisting (Rust `WEB_CACHE_DOCUMENT_LIMIT`). */
export function webCacheDocumentLimit(): number {
  return rawWebCacheDocumentLimit();
}
