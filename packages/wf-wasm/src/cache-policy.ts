export {
  screenCachePolicy,
} from "../pkg/wf_wasm.js";
/**
 * Screen-cache ages (Rust `cache_policy`), re-exported from index.ts. The app keeps its own
 * constants for module-evaluation-time reads; this is for callers that run after wasm init.
 */

