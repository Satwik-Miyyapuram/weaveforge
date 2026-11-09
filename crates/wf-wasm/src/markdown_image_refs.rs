//! Unresolved image reference stripping for JavaScript (wf-core `markdown_image_refs`).

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::markdown_image_refs;

/// [`strip_unresolved_image_refs`](markdown_image_refs::strip_unresolved_image_refs).
/// `paths` and `resolved` are JS string arrays.
#[wasm_bindgen(js_name = stripUnresolvedImageRefs)]
pub fn strip_unresolved_image_refs_js(
    body: &str,
    prefix: &str,
    paths: JsValue,
    resolved: JsValue,
) -> Result<String, serde_wasm_bindgen::Error> {
    super::check_text(body)?;
    let paths: Vec<String> = serde_wasm_bindgen::from_value(paths)?;
    let resolved: Vec<String> = serde_wasm_bindgen::from_value(resolved)?;
    Ok(markdown_image_refs::strip_unresolved_image_refs(body, prefix, &paths, &resolved))
}