//! The meaning-search status line for JavaScript (wf-core `semantic_status_text`).

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::{JsError, wasm_bindgen};
use wf_core::semantic_status_text::{self, SemanticStatus};

/// [`semantic_status_text`](semantic_status_text::semantic_status_text). `status` is a
/// `SemanticStatus` (tagged by `phase`).
///
/// # Errors
///
/// Fails if `status` cannot be read as the expected shape.
#[wasm_bindgen(js_name = semanticStatusText)]
pub fn semantic_status_text_js(
    #[wasm_bindgen(unchecked_param_type = "B.SemanticStatus")] status: JsValue,
) -> Result<String, JsError> {
    let status: SemanticStatus =
        serde_wasm_bindgen::from_value(status).map_err(|e| JsError::new(&e.to_string()))?;
    Ok(semantic_status_text::semantic_status_text(&status))
}
