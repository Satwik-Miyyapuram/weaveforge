//! Overleaf link rules for JavaScript (wf-core `overleaf_link`).

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::overleaf_link::{check_link_folder, parse_links};

use super::to_js;

/// [`check_link_folder`]: whether a vault-relative folder may be linked, and its normalised form.
/// A non-string is refused with the same reason as a bad folder.
///
/// # Errors
///
/// Fails only if the result cannot be converted to JS.
#[wasm_bindgen(
    js_name = checkOverleafLinkFolder,
    unchecked_return_type = "{ ok: true; folder: string } | { ok: false; reason: string }"
)]
pub fn check_overleaf_link_folder_js(
    #[wasm_bindgen(unchecked_param_type = "unknown")] raw: &JsValue,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    // An empty folder gets the refusal every bad folder gets.
    to_js(&check_link_folder(&raw.as_string().unwrap_or_default()))
}

/// [`parse_links`]: the well-formed links in the stored JSON. A non-string gives no links.
///
/// # Errors
///
/// Fails only if the result cannot be converted to JS.
#[wasm_bindgen(
    js_name = parseOverleafLinks,
    unchecked_return_type = "{ projectId: string; folder: string }[]"
)]
pub fn parse_overleaf_links_js(
    #[wasm_bindgen(unchecked_param_type = "unknown")] stored: &JsValue,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    // An empty string is not JSON, so it gives no links.
    to_js(&parse_links(&stored.as_string().unwrap_or_default()))
}
