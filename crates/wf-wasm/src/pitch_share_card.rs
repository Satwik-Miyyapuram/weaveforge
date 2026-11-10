//! wasm exports for `pitch_share_card` (TS: `packages/wf-wasm/src/pitch-share-card.ts`).

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::pitch_share_card::{app_origin_from, pitch_share_card, pitch_share_constants};

use super::to_js;

/// [`app_origin_from`]: `configured` is the optional origin override. Unset, empty or
/// not an absolute http(s) URL gives the default origin.
#[wasm_bindgen(js_name = appOriginFrom)]
#[must_use]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn app_origin_from_js(configured: Option<String>) -> String {
    app_origin_from(configured.as_deref())
}

/// [`pitch_share_constants`]: the shared title, description and default origin.
///
/// # Errors
///
/// Fails if the result cannot be converted to JS.
#[wasm_bindgen(js_name = pitchShareConstants, unchecked_return_type = "{ title: string; description: string; defaultAppOrigin: string }")]
pub fn pitch_share_constants_js() -> Result<JsValue, serde_wasm_bindgen::Error> {
    to_js(&pitch_share_constants())
}

/// [`pitch_share_card`]: the card metadata for `basePath` and `path`, without `metadataBase`.
///
/// # Errors
///
/// Fails if the result cannot be converted to JS.
#[wasm_bindgen(js_name = pitchShareCard, unchecked_return_type = "{ title: string; description: string; ogType: string; siteName: string; locale: string; url: string; image: { url: string; width: number; height: number; alt: string }; twitterCard: string }")]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn pitch_share_card_js(
    base_path: String,
    path: String,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    to_js(&pitch_share_card(&base_path, &path))
}
