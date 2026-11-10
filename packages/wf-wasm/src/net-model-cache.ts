export {
  cachePathSegments,
  modelCacheUrl,
} from "../pkg/wf_wasm.js";
/**
 * Model-cache URL and path checks (Rust `net::model_cache`), re-exported from index.ts.
 * Each function keeps the signature of apps/desktop/src/model-cache.ts. A malformed URL throws,
 * as `new URL` did; the thrown error is a plain `Error`, not a `TypeError` or `URIError`.
 */

