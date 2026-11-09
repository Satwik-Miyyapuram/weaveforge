/**
 * The IndexedDB PDF cache's eviction choice (Rust `reader::pdf_cache_eviction`),
 * re-exported from index.ts.
 */
import { pickKeysToEvict as rawPickKeysToEvict } from "../pkg/wf_wasm.js";
import type { CachedPdfAge } from "./bindings.js";

export type { CachedPdfAge };

/**
 * The keys to drop, oldest first, so at most `maxEntries` remain. Throws an Error
 * when `maxEntries` is not a positive integer.
 */
export function pickKeysToEvict(
  entries: readonly CachedPdfAge[],
  maxEntries: number,
): string[] {
  return rawPickKeysToEvict(entries, maxEntries) as string[];
}
