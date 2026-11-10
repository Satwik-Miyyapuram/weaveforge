export {
  shouldPersistIndex,
  webCacheDocumentLimit,
} from "../pkg/wf_wasm.js";
/**
 * Index persistence rule (Rust `index_cache_policy`). The caller supplies whether
 * this is the installed app; platform detection stays in the app.
 */

