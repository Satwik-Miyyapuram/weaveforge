//! Redirect and body-cap decisions for JavaScript (wf-core `redirect`). The JS names match
//! `apps/web/src/backend/net/safe-fetch.ts`.

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::net::redirect;

use super::to_js;

/// [`next_redirect`](redirect::next_redirect): follow, stop with a message, or not a redirect.
/// `resolved` is the TS `new URL(location, base).href`, or `undefined` when that parse threw.
///
/// # Errors
///
/// Fails if the step cannot be converted to a JS value.
#[wasm_bindgen(js_name = nextRedirect, unchecked_return_type = "{ kind: 'not-redirect' } | { kind: 'follow'; url: string } | { kind: 'failed'; message: string }")]
pub fn next_redirect_js(
    status: u16,
    location: Option<String>,
    resolved: Option<String>,
    hop: u32,
    max_redirects: u32,
) -> Result<wasm_bindgen::JsValue, serde_wasm_bindgen::Error> {
    to_js(&redirect::next_redirect(
        status,
        location.as_deref(),
        resolved.as_deref(),
        hop,
        max_redirects,
    ))
}

/// [`declared_length_over_cap`](redirect::declared_length_over_cap): refuse before reading when true.
#[wasm_bindgen(js_name = declaredLengthOverCap)]
#[must_use]
pub fn declared_length_over_cap_js(declared: f64, max_bytes: f64) -> bool {
    redirect::declared_length_over_cap(declared, max_bytes)
}
