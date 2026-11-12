//! Zotero Web API library helpers for JavaScript (wf-core `papers::zotero_library`).
//! The JS names match `packages/wf-wasm/src/wrappers-12.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::papers::zotero_library::{self, ZoteroChildProbe};

use super::to_js;

/// [`is_child_item`](zotero_library::is_child_item): true for an attachment, note, annotation or
/// an item with a parent.
///
/// # Errors
///
/// Fails if `item` cannot be read as an object.
#[wasm_bindgen(js_name = isZoteroChildItem, unchecked_return_type = "boolean")]
pub fn is_zotero_child_item_js(
    #[wasm_bindgen(unchecked_param_type = "unknown")] item: JsValue,
) -> Result<bool, JsValue> {
    let item: ZoteroChildProbe = serde_wasm_bindgen::from_value(item)?;
    Ok(zotero_library::is_child_item(&item))
}

/// [`normalize_zotero_library`](zotero_library::normalize_zotero_library): the library path, or
/// `undefined` when the input is not a library.
///
/// # Errors
///
/// Fails if `library` is neither a string nor missing.
#[wasm_bindgen(js_name = normalizeZoteroLibrary)]
pub fn normalize_zotero_library_js(
    #[wasm_bindgen(unchecked_param_type = "string | undefined")] library: JsValue,
) -> Result<Option<String>, JsValue> {
    let library: Option<String> = serde_wasm_bindgen::from_value(library)?;
    Ok(zotero_library::normalize_zotero_library(library.as_deref()))
}

/// [`zotero_library_url`](zotero_library::zotero_library_url): the API URL for a library path.
#[wasm_bindgen(js_name = zoteroLibraryUrl)]
#[must_use]
pub fn zotero_library_url_js(library: &str, api_origin: &str) -> String {
    zotero_library::zotero_library_url(library, api_origin)
}

/// [`zotero_headers`](zotero_library::zotero_headers): the API key and version headers for a
/// request, as a plain object.
///
/// # Errors
///
/// Fails only if the headers cannot be converted to a JS value.
#[wasm_bindgen(js_name = zoteroHeaders, unchecked_return_type = "Record<string, string>")]
pub fn zotero_headers_js(api_key: &str) -> Result<JsValue, JsValue> {
    Ok(to_js(&zotero_library::zotero_headers(api_key))?)
}

/// [`zotero_top_level_path`](zotero_library::zotero_top_level_path): the top-level items path,
/// inside a collection when one is given.
#[wasm_bindgen(js_name = zoteroTopLevelPath)]
#[must_use]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs an owned Option<String>.
pub fn zotero_top_level_path_js(collection: Option<String>) -> String {
    zotero_library::zotero_top_level_path(collection.as_deref())
}

/// [`zotero_page_url`](zotero_library::zotero_page_url): one page of a Zotero read (TS `buildUrl`).
/// `params` is the `Object.entries` list of the request params, so its order is kept.
///
/// # Errors
///
/// Fails if `params` is not a list of `[key, value]` pairs.
#[wasm_bindgen(js_name = zoteroPageUrl)]
pub fn zotero_page_url_js(
    base_url: &str,
    path: Option<String>,
    #[wasm_bindgen(unchecked_param_type = "readonly [string, string | null | undefined][]")]
    params: JsValue,
    start: u32,
    limit: u32,
) -> Result<String, JsValue> {
    let params: Vec<(String, Option<String>)> = serde_wasm_bindgen::from_value(params)?;
    Ok(zotero_library::zotero_page_url(
        base_url,
        path.as_deref(),
        &params,
        u64::from(start),
        u64::from(limit),
    ))
}

/// [`zotero_keys_url`](zotero_library::zotero_keys_url): a keys-only read (TS `fetchZoteroItemKeys`).
///
/// # Errors
///
/// Fails if `params` is not a list of `[key, value]` pairs.
#[wasm_bindgen(js_name = zoteroKeysUrl)]
pub fn zotero_keys_url_js(
    base_url: &str,
    path: Option<String>,
    #[wasm_bindgen(unchecked_param_type = "readonly [string, string | null | undefined][]")]
    params: JsValue,
) -> Result<String, JsValue> {
    let params: Vec<(String, Option<String>)> = serde_wasm_bindgen::from_value(params)?;
    Ok(zotero_library::zotero_keys_url(
        base_url,
        path.as_deref(),
        &params,
    ))
}

/// [`zotero_total_results`](zotero_library::zotero_total_results): the `Total-Results` count, or
/// `undefined` when absent or unusable (TS `getPage`).
#[wasm_bindgen(js_name = zoteroTotalResults)]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs an owned Option<String>.
pub fn zotero_total_results_js(header: Option<String>) -> Option<f64> {
    zotero_library::zotero_total_results(header.as_deref())
}

/// [`zotero_page_starts`](zotero_library::zotero_page_starts): the offsets after the first page
/// (TS `fetchAllZoteroItems`).
///
/// # Errors
///
/// Fails only if the offsets cannot be converted to a JS array.
#[wasm_bindgen(js_name = zoteroPageStarts, unchecked_return_type = "number[]")]
pub fn zotero_page_starts_js(total: f64, page: u32) -> Result<JsValue, JsValue> {
    Ok(to_js(&zotero_library::zotero_page_starts(
        total,
        u64::from(page),
    ))?)
}

/// [`zotero_server_backoff_ms`](zotero_library::zotero_server_backoff_ms): the wait a response's
/// `Backoff` (or `Retry-After`) header asks for, or `undefined` (TS `BackoffGate.note`).
#[wasm_bindgen(js_name = zoteroServerBackoffMs)]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned Option<String> arguments.
pub fn zotero_server_backoff_ms_js(
    backoff: Option<String>,
    retry_after: Option<String>,
) -> Option<f64> {
    zotero_library::zotero_server_backoff_ms(backoff.as_deref(), retry_after.as_deref())
}

/// [`zotero_attempt_backoff_ms`](zotero_library::zotero_attempt_backoff_ms): the wait after a 429
/// with no usable header (TS `BackoffGate.noteAttempt`).
#[wasm_bindgen(js_name = zoteroAttemptBackoffMs)]
#[must_use]
pub fn zotero_attempt_backoff_ms_js(attempt: u32) -> f64 {
    zotero_library::zotero_attempt_backoff_ms(attempt)
}
