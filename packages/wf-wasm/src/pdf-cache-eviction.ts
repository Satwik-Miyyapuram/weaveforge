/**
 * The IndexedDB PDF cache's eviction choice (Rust `reader::pdf_cache_eviction`),
 * re-exported from index.ts.
 */
import type {
  CachedPdfAge,
} from "./bindings.js";

export {
  pickKeysToEvict,
} from "../pkg/wf_wasm.js";

export type { CachedPdfAge };

