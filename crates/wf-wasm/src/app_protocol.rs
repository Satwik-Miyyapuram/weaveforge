//! `app://` protocol rules for JavaScript (wf-core `app_protocol`). The JS names
//! match `packages/wf-wasm/src/app-protocol.ts`.

use serde_json::Value;
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::app_protocol;

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`app_file_candidates`](app_protocol::app_file_candidates) as an array of
/// paths in try order, or `null` when the request is not inside `root`.
/// `sep` is the platform separator (its first character is used).
///
/// # Errors
///
/// Fails only if the result cannot be turned into a JS value.
#[wasm_bindgen(js_name = appFileCandidates)]
pub fn app_file_candidates_js(root: &str, request_url: &str, sep: &str) -> JsResult<JsValue> {
    let sep = sep.chars().next().unwrap_or('/');
    to_js(&app_protocol::app_file_candidates(root, request_url, sep))
}

/// [`canonical_app_url`](app_protocol::canonical_app_url): the URL with its
/// path's repeated slashes collapsed, or `null` when no redirect is needed.
///
/// # Errors
///
/// Fails only if the result cannot be turned into a JS value.
#[wasm_bindgen(js_name = appCanonicalUrl)]
pub fn app_canonical_url_js(request_url: &str) -> JsResult<JsValue> {
    to_js(&app_protocol::canonical_app_url(request_url))
}

/// [`is_page_request`](app_protocol::is_page_request).
#[wasm_bindgen(js_name = appIsPageRequest)]
#[must_use]
pub fn app_is_page_request_js(request_url: &str) -> bool {
    app_protocol::is_page_request(request_url)
}

/// [`app_headers`](app_protocol::app_headers) as a plain object.
///
/// # Errors
///
/// Fails only if the headers cannot be turned into a JS value.
#[wasm_bindgen(js_name = appHeaders)]
pub fn app_headers_js(content_type: &str) -> JsResult<JsValue> {
    to_js(&Value::Object(app_protocol::app_headers(content_type)))
}

/// [`content_type_for`](app_protocol::content_type_for).
#[wasm_bindgen(js_name = appContentTypeFor)]
#[must_use]
pub fn app_content_type_for_js(file: &str) -> String {
    app_protocol::content_type_for(file).to_owned()
}
