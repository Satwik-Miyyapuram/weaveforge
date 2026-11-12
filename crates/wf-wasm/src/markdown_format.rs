//! Markdown formatting for the editor (`wf_core::markdown_format`).
//!
//! The editor lists the actions once, then applies one by id to the document and the selection.
//! The result is the edits and the selection after them, applied by the TypeScript caller.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::markdown_format::{Outcome, Span, action_infos, apply, format_for};

use super::{check_text, to_js};

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// Every formatting action, as `{ id, label, key, accelerator }` (`B.MarkdownActionInfo[]`).
///
/// # Errors
///
/// Fails when the list cannot be converted to a JS value.
#[wasm_bindgen(js_name = markdownFormatActions, unchecked_return_type = "B.MarkdownActionInfo[]")]
pub fn markdown_format_actions() -> JsResult<JsValue> {
    to_js(&action_infos())
}

/// Applies the action `id` to `doc` with the selection `ranges` (UTF-16 offsets) and the main
/// selection's head. Returns the edits and the selection after them, or `null` when the action
/// does nothing here (`B.MarkdownOutcome | null`).
///
/// # Errors
///
/// Fails when `id` names no action, when `doc` is over the text cap, or when the arguments
/// cannot be read.
#[wasm_bindgen(js_name = markdownFormatAction, unchecked_return_type = "B.MarkdownOutcome | null")]
pub fn markdown_format_action(
    #[wasm_bindgen(unchecked_param_type = "string")] id: &str,
    #[wasm_bindgen(unchecked_param_type = "string")] doc: &str,
    #[wasm_bindgen(unchecked_param_type = "B.MarkdownSpan[]")] ranges: JsValue,
    #[wasm_bindgen(unchecked_param_type = "number")] main_head: usize,
) -> JsResult<JsValue> {
    check_text(doc)?;
    let format = format_for(id)
        .ok_or_else(|| serde_wasm_bindgen::Error::new(format!("unknown markdown action: {id}")))?;
    let ranges: Vec<Span> = serde_wasm_bindgen::from_value(ranges)?;
    match apply(format, doc, &ranges, main_head) {
        Some(outcome) => to_js::<Outcome>(&outcome),
        None => Ok(JsValue::NULL),
    }
}
