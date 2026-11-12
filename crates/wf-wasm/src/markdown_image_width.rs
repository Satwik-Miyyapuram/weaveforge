//! Markdown image width and placement for JavaScript (wf-core `markdown_image_width`).

#![allow(
    clippy::needless_pass_by_value,
    reason = "wasm-bindgen exports take owned values"
)]
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::markdown_image_width::{self, ImagePlacementPatch};

/// [`with_image_width`](markdown_image_width::with_image_width): the alt for a width, keeping any
/// crop or side. `null` clears the width.
///
/// # Errors
///
/// Fails if `alt` is longer than the index text limit.
#[wasm_bindgen(js_name = withImageWidth)]
pub fn with_image_width_js(
    alt: js_sys::JsString,
    width: Option<String>,
) -> Result<String, serde_wasm_bindgen::Error> {
    let alt = &crate::guarded_text(&alt)?;
    Ok(markdown_image_width::with_image_width(
        alt,
        width.as_deref(),
    ))
}

/// [`set_image_placement`](markdown_image_width::set_image_placement): rewrite the `ordinal`-th
/// image whose alt is `alt` to the patched placement.
///
/// # Errors
///
/// Fails if `body` or `alt` is too long, or `patch` has the wrong shape.
#[wasm_bindgen(js_name = setImagePlacement)]
pub fn set_image_placement_js(
    body: js_sys::JsString,
    alt: js_sys::JsString,
    ordinal: usize,
    #[wasm_bindgen(unchecked_param_type = "B.ImagePlacementPatch")] patch: JsValue,
) -> Result<String, serde_wasm_bindgen::Error> {
    let body = &crate::guarded_text(&body)?;
    let alt = &crate::guarded_text(&alt)?;
    let patch: ImagePlacementPatch = serde_wasm_bindgen::from_value(defined_fields(&patch))?;
    Ok(markdown_image_width::set_image_placement(
        body, alt, ordinal, &patch,
    ))
}

/// A copy of `patch` without its `undefined` fields, so `{ width: undefined }`
/// keeps the width like an absent key (only `null` clears). Non-objects pass through.
fn defined_fields(patch: &JsValue) -> JsValue {
    if !patch.is_object() {
        return patch.clone();
    }
    let out = js_sys::Object::new();
    for entry in js_sys::Object::entries(&js_sys::Object::from(patch.clone())).iter() {
        let pair = js_sys::Array::from(&entry);
        let value = pair.get(1);
        if !value.is_undefined() {
            // Setting a plain data property on a fresh object cannot fail.
            let _ = js_sys::Reflect::set(&out, &pair.get(0), &value);
        }
    }
    out.into()
}
