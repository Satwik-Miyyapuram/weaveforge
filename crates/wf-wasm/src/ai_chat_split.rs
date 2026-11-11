//! Chat system-prompt split for JavaScript (wf-core `ai::chat_split`). The JS name matches
//! `packages/wf-wasm/src/wrappers-1.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::{JsError, wasm_bindgen};
use wf_core::ai::chat_split::split_system;

use super::to_js;

/// [`split_system`](wf_core::ai::chat_split::split_system): `{ system, rest }` for a JS array of messages.
///
/// # Errors
///
/// Fails when `messages` is not an array of JSON-compatible values, or when the result cannot be converted to a JS value.
#[wasm_bindgen(js_name = splitAiSystemMessages)]
pub fn split_ai_system_messages_js(messages: JsValue) -> Result<JsValue, JsError> {
    let messages: Vec<serde_json::Value> = serde_wasm_bindgen::from_value(messages)
        .map_err(|error| JsError::new(&error.to_string()))?;
    let split = split_system(&messages);
    to_js(&split).map_err(|error| JsError::new(&error.to_string()))
}
