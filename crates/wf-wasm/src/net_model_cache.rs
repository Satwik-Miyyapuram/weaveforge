//! Model-cache URL and path checks for JavaScript (wf-core `model_cache`). The JS names match
//! `apps/desktop/src/model-cache.ts`.

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::net::model_cache;

/// [`try_model_cache_url`](model_cache::try_model_cache_url): the cache URL a request names, or
/// `null` when it is not a weights request.
///
/// # Errors
///
/// Throws on a URL that does not parse, as `new URL` did in the TS.
#[wasm_bindgen(js_name = modelCacheUrl)]
pub fn model_cache_url_js(
    url: &str,
    app_host: &str,
) -> Result<Option<String>, serde_wasm_bindgen::Error> {
    model_cache::try_model_cache_url(url, app_host)
        .map_err(|_| serde_wasm_bindgen::Error::new("Invalid URL"))
}

/// [`try_cache_path_segments`](model_cache::try_cache_path_segments): the segments a cache URL
/// names under the cache root, or `null` when it names none or would leave the root.
///
/// # Errors
///
/// Throws on a URL that does not parse, or a path escape `decodeURIComponent` rejects, as the
/// TS did.
#[wasm_bindgen(js_name = cachePathSegments)]
pub fn cache_path_segments_js(url: &str) -> Result<Option<Vec<String>>, serde_wasm_bindgen::Error> {
    model_cache::try_cache_path_segments(url)
        .map_err(|_| serde_wasm_bindgen::Error::new("URI malformed"))
}
