//! Tag colour slot for JavaScript (wf-core `tag_tone`).

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::tag_tone;

/// [`tag_tone`](tag_tone::tag_tone): colour slot `1..=6` for a tag.
#[wasm_bindgen(js_name = tagTone)]
pub fn tag_tone_js(tag: js_sys::JsString) -> Result<u32, serde_wasm_bindgen::Error> {
    let tag = &crate::guarded_text(&tag)?;
    Ok(tag_tone::tag_tone(tag))
}
