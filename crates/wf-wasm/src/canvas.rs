//! wasm exports for `canvas` (TS: `features/canvas/application/canvas-doc.ts`). Each takes the
//! canvas note's body text, so no canvas object crosses the boundary and unknown fields stay
//! in the text.

use serde::Serialize;
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::{JsError, wasm_bindgen};
use wf_core::canvas;
use wf_core::canvas::excalidraw::{self, ExcalidrawImage};

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

/// An Excalidraw drawing read as canvas text, with the images to upload.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportedDrawing {
    canvas_text: String,
    images: Vec<ExcalidrawImage>,
    warnings: Vec<String>,
}

/// [`excalidraw::import_excalidraw`]: an `.excalidraw` or `.excalidraw.md` file as canvas
/// text in Obsidian's layout.
///
/// # Errors
///
/// Fails when the text is not an Excalidraw drawing.
#[wasm_bindgen(
    js_name = importExcalidraw,
    unchecked_return_type = "{ canvasText: string; images: B.ExcalidrawImage[]; warnings: string[] }"
)]
pub fn import_excalidraw_js(text: &str) -> Result<JsValue, JsError> {
    let read = excalidraw::import_excalidraw(text).map_err(|e| JsError::new(&e))?;
    to_js(&ImportedDrawing {
        canvas_text: canvas::canvas_text(&read.canvas),
        images: read.images,
        warnings: read.warnings,
    })
    .map_err(|e| JsError::new(&e.to_string()))
}

/// [`excalidraw::export_excalidraw`]: the canvas as `.excalidraw` JSON, with `images` (the
/// file nodes' contents) embedded.
///
/// # Errors
///
/// Fails when the text is not a JSON Canvas file or `images` is not a list of images.
#[wasm_bindgen(js_name = exportExcalidraw, unchecked_return_type = "B.ExcalidrawExport")]
pub fn export_excalidraw_js(
    text: &str,
    #[wasm_bindgen(unchecked_param_type = "B.ExcalidrawImage[]")] images: JsValue,
) -> Result<JsValue, JsError> {
    let images: Vec<ExcalidrawImage> = serde_wasm_bindgen::from_value(images)?;
    to_js(&excalidraw::export_excalidraw(&read(text)?, &images))
        .map_err(|e| JsError::new(&e.to_string()))
}
