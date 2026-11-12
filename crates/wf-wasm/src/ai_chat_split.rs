//! Chat system-prompt split for JavaScript (wf-core `ai::chat_split`). The JS name matches
//! the former `packages/wf-wasm/src/wrappers-1.ts` wrapper, now served straight from wasm.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::{JsError, wasm_bindgen};
use wf_core::ai::chat_split::split_system;

use super::to_js;

#[wasm_bindgen(typescript_custom_section)]
const SPLIT_AI_SYSTEM_MESSAGES_TS: &str = r"
/** The system messages joined by a blank line, and the other messages in order, extra fields included. */
export interface AiSplitSystem<M> { system: string; rest: M[] }
/** Splits chat messages into the joined system prompt and the other messages. */
export function splitAiSystemMessages<M extends { role: string }>(messages: readonly M[]): AiSplitSystem<M>;
";

/// [`split_system`](wf_core::ai::chat_split::split_system): `{ system, rest }` for a JS array of messages.
///
/// # Errors
///
/// Fails when `messages` is not an array of JSON-compatible values, or when the result cannot be converted to a JS value.
#[wasm_bindgen(js_name = splitAiSystemMessages, skip_typescript)]
pub fn split_ai_system_messages_js(messages: JsValue) -> Result<JsValue, JsError> {
    let messages: Vec<serde_json::Value> = serde_wasm_bindgen::from_value(messages)
        .map_err(|error| JsError::new(&error.to_string()))?;
    let split = split_system(&messages);
    to_js(&split).map_err(|error| JsError::new(&error.to_string()))
}
