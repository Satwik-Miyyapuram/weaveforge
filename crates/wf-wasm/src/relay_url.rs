//! Relay route URLs for JavaScript (wf-core `relay_url`). The JS names match
//! `apps/web/src/lib/relay-url.ts`; the base is read from the environment in TS.

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::relay_url::{relay_path, relay_url};

/// [`relay_url`] (TS `relayUrl`): the base joined to `path`, or `path` when `base` is absent.
#[wasm_bindgen(js_name = relayUrl)]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn relay_url_js(base: Option<String>, path: String) -> String {
    relay_url(base.as_deref(), &path)
}

/// [`relay_path`] (TS `relayPath`): the route path inside a relay URL, or `url` unchanged.
#[wasm_bindgen(js_name = relayPath)]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn relay_path_js(base: Option<String>, url: String) -> String {
    relay_path(base.as_deref(), &url)
}
