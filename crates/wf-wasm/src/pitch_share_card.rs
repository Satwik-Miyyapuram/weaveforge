//! wasm exports for `pitch_share_card` (served straight from `@weaveforge/wasm`).

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::pitch_share_card::app_origin_from;

/// [`app_origin_from`]: `configured` is the optional origin override. Unset, empty or
/// not an absolute http(s) URL gives the default origin.
#[wasm_bindgen(js_name = appOriginFrom)]
#[must_use]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn app_origin_from_js(configured: Option<String>) -> String {
    app_origin_from(configured.as_deref())
}
