//! Same-origin deep link for JavaScript (wf-core `reader::build_locus_link`).

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::reader::build_locus_link::{LocusLinkInput, build_locus_link};

/// [`build_locus_link`] (TS `buildLocusLink`): the `/reader` path for `input`.
///
/// # Errors
///
/// Fails if `input` is not a `LocusLinkInput` object.
#[wasm_bindgen(js_name = buildLocusLink)]
pub fn build_locus_link_js(input: JsValue) -> Result<String, serde_wasm_bindgen::Error> {
    let input: LocusLinkInput = serde_wasm_bindgen::from_value(input)?;
    Ok(build_locus_link(&input))
}
