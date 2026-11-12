//! Folder preview read rules for JavaScript (wf-core `workspace::preview_read`).

use wasm_bindgen::JsError;
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::workspace::preview_read::{self, PreviewEntry, PreviewLimits};

use super::to_js;

#[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
fn whole(n: f64) -> u64 {
    n.max(0.0).round() as u64
}

/// [`plan_preview_reads`](preview_read::plan_preview_reads): the notes and data files to read as
/// text, and the listed assets. `only` is `undefined` for a full preview.
///
/// # Errors
///
/// Fails if an argument has the wrong shape, or the result cannot be serialized.
#[wasm_bindgen(
    js_name = planPreviewReads,
    unchecked_return_type = "{ notes: string[]; json: string[]; assets: { path: string; size: number }[] }"
)]
pub fn plan_preview_reads_js(
    #[wasm_bindgen(unchecked_param_type = "readonly { path: string; size: number }[]")]
    entries: JsValue,
    project_root: String,
    has_project_dir: bool,
    #[wasm_bindgen(unchecked_param_type = "readonly string[] | undefined")] only: JsValue,
) -> Result<JsValue, JsError> {
    let entries: Vec<PreviewEntry> =
        serde_wasm_bindgen::from_value(entries).map_err(|e| JsError::new(&e.to_string()))?;
    let only: Option<Vec<String>> =
        serde_wasm_bindgen::from_value(only).map_err(|e| JsError::new(&e.to_string()))?;
    let reads =
        preview_read::plan_preview_reads(&entries, &project_root, has_project_dir, only.as_deref());
    to_js(&reads).map_err(|e| JsError::new(&e.to_string()))
}

/// [`plan_asset_reads`](preview_read::plan_asset_reads): the selected assets in listing order,
/// each `read` or `too-big`. `only` is `undefined` for a full preview.
///
/// # Errors
///
/// Fails if an argument has the wrong shape.
#[wasm_bindgen(
    js_name = planAssetReads,
    unchecked_return_type = "{ path: string; action: 'read' | 'too-big' }[]"
)]
pub fn plan_asset_reads_js(
    #[wasm_bindgen(unchecked_param_type = "readonly { path: string; size: number }[]")]
    assets: JsValue,
    #[wasm_bindgen(unchecked_param_type = "readonly string[] | undefined")] only: JsValue,
    #[wasm_bindgen(unchecked_param_type = "readonly string[]")] note_texts: JsValue,
    #[wasm_bindgen(unchecked_param_type = "{ maxTotalBytes: number; maxFileBytes: number }")]
    limits: JsValue,
) -> Result<JsValue, JsError> {
    let assets: Vec<PreviewEntry> =
        serde_wasm_bindgen::from_value(assets).map_err(|e| JsError::new(&e.to_string()))?;
    let only: Option<Vec<String>> =
        serde_wasm_bindgen::from_value(only).map_err(|e| JsError::new(&e.to_string()))?;
    let note_texts: Vec<String> =
        serde_wasm_bindgen::from_value(note_texts).map_err(|e| JsError::new(&e.to_string()))?;
    let limits: PreviewLimits =
        serde_wasm_bindgen::from_value(limits).map_err(|e| JsError::new(&e.to_string()))?;
    let picks = preview_read::plan_asset_reads(&assets, only.as_deref(), &note_texts, limits);
    to_js(&picks).map_err(|e| JsError::new(&e.to_string()))
}

/// [`admit_asset_bytes`](preview_read::admit_asset_bytes): whether an asset's real bytes are kept,
/// and the running total. Called once per asset that was read, in order.
///
/// # Errors
///
/// Throws when keeping the asset would pass the total cap.
#[wasm_bindgen(
    js_name = admitAssetBytes,
    unchecked_return_type = "{ keep: boolean; total: number }"
)]
pub fn admit_asset_bytes_js(
    running_total: f64,
    byte_len: f64,
    #[wasm_bindgen(unchecked_param_type = "{ maxTotalBytes: number; maxFileBytes: number }")]
    limits: JsValue,
) -> Result<JsValue, JsError> {
    let limits: PreviewLimits =
        serde_wasm_bindgen::from_value(limits).map_err(|e| JsError::new(&e.to_string()))?;
    let admit = preview_read::admit_asset_bytes(whole(running_total), whole(byte_len), limits)
        .map_err(|message| JsError::new(&message))?;
    to_js(&admit).map_err(|e| JsError::new(&e.to_string()))
}
