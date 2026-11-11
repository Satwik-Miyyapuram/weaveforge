//! AI session start for JavaScript (wf-core `ai::session_grant`). The JS name matches
//! `packages/core/src/features/ai-assistant/application/parts.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::{JsError, wasm_bindgen};
use wf_core::ai::session_grant::{self, SessionGrantInput};

use super::to_js;

/// [`start_session`](session_grant::start_session): the session, or the message for the first failed check.
///
/// # Errors
///
/// Fails with the user-facing message when a check fails, or when the input is malformed.
#[wasm_bindgen(js_name = startAiSession)]
pub fn start_ai_session_js(input: JsValue) -> Result<JsValue, JsError> {
    let input: SessionGrantInput = serde_wasm_bindgen::from_value(input).map_err(js_error)?;
    let session = session_grant::start_session(&input).map_err(|message| JsError::new(&message))?;
    to_js(&session).map_err(js_error)
}

fn js_error(error: serde_wasm_bindgen::Error) -> JsError {
    JsError::new(&error.to_string())
}
