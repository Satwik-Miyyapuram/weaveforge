//! wasm exports for `canvas` (TS: `features/canvas/application/canvas-doc.ts`). Each takes the
//! canvas note's body text, so no canvas object crosses the boundary and unknown fields stay
//! in the text.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::{JsError, wasm_bindgen};
use wf_core::canvas;

use super::to_js;

fn read(text: &str) -> Result<canvas::Canvas, JsError> {
    canvas::parse_canvas(text).map_err(|e| JsError::new(&e))
}

/// [`canvas::normalize_canvas_text`]: the text in Obsidian's layout, as a canvas note is saved.
///
/// # Errors
///
/// Fails when the text is not a JSON Canvas file.
#[wasm_bindgen(js_name = normalizeCanvasText)]
pub fn normalize_canvas_text_js(text: &str) -> Result<String, JsError> {
    canvas::normalize_canvas_text(text).map_err(|e| JsError::new(&e))
}

/// [`canvas::validate`]: the rules the canvas breaks; empty when none.
///
/// # Errors
///
/// Fails when the text is not a JSON Canvas file.
#[wasm_bindgen(js_name = validateCanvasText, unchecked_return_type = "B.CanvasIssue[]")]
pub fn validate_canvas_text_js(text: &str) -> Result<JsValue, JsError> {
    to_js(&canvas::validate(&read(text)?)).map_err(|e| JsError::new(&e.to_string()))
}

/// [`canvas::canvas_bounds`]: the box around every node (fit to view), `null` when empty.
///
/// # Errors
///
/// Fails when the text is not a JSON Canvas file.
#[wasm_bindgen(js_name = canvasBounds, unchecked_return_type = "B.CanvasRect | null")]
pub fn canvas_bounds_js(text: &str) -> Result<JsValue, JsError> {
    to_js(&canvas::canvas_bounds(&read(text)?)).map_err(|e| JsError::new(&e.to_string()))
}

/// [`canvas::group_members`]: ids of the nodes a group drags along.
///
/// # Errors
///
/// Fails when the text is not a JSON Canvas file.
#[wasm_bindgen(js_name = canvasGroupMembers)]
pub fn canvas_group_members_js(text: &str, group_id: &str) -> Result<Vec<String>, JsError> {
    Ok(canvas::group_members(&read(text)?, group_id))
}
