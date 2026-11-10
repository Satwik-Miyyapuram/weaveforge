/**
 * Model-cache URL and path checks (Rust `net::model_cache`), re-exported from index.ts.
 * Each function keeps the signature of apps/desktop/src/model-cache.ts. A malformed URL throws,
 * as `new URL` did; the thrown error is a plain `Error`, not a `TypeError` or `URIError`.
 */
import {
  cachePathSegments as rawCachePathSegments,
  modelCacheUrl as rawModelCacheUrl,
} from "../pkg/wf_wasm.js";

/** The cache URL a request names, or null when it is not a weights request. Throws on a malformed URL. */
export function modelCacheUrl(url: string, appHost: string): string | null {
  return rawModelCacheUrl(url, appHost) as string | null;
}

/**
 * The segments a cache URL names under the cache root, or null when it names none or would leave
 * the root. Throws on a malformed URL or a rejected escape.
 */
export function cachePathSegments(url: string): string[] | null {
  return rawCachePathSegments(url) as string[] | null;
}
