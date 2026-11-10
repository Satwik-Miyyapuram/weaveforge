//! API-host check for JavaScript (wf-core `api_host`). The JS name matches
//! `apps/desktop/src/api-cors.ts`.

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::net::api_host;

/// [`is_api_host`](api_host::is_api_host): the URL's host is `weaveforge.org` or a subdomain of it.
#[wasm_bindgen(js_name = isApiHost)]
#[must_use]
pub fn is_api_host_js(url: &str) -> bool {
    api_host::is_api_host(url)
}
