//! Overleaf link rules for JavaScript (wf-core `overleaf_link`). JS names match
//! `packages/wf-wasm/src/overleaf-link.ts`.

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::overleaf_link::{check_link_folder, parse_links};

use super::to_js;

/// [`check_link_folder`]: whether a vault-relative folder may be linked, and its normalised form.
///
/// # Errors
///
/// Fails only if the result cannot be converted to JS.
#[wasm_bindgen(js_name = checkOverleafLinkFolder)]
pub fn check_overleaf_link_folder_js(
    raw: &str,
) -> Result<wasm_bindgen::JsValue, serde_wasm_bindgen::Error> {
    to_js(&check_link_folder(raw))
}

/// [`parse_links`]: the well-formed links in the stored JSON.
///
/// # Errors
///
/// Fails only if the result cannot be converted to JS.
#[wasm_bindgen(js_name = parseOverleafLinks)]
pub fn parse_overleaf_links_js(
    stored: &str,
) -> Result<wasm_bindgen::JsValue, serde_wasm_bindgen::Error> {
    to_js(&parse_links(stored))
}
