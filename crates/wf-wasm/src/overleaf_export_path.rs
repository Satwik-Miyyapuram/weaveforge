//! Export path guard and missing-figure warning (wf-core `overleaf::export_path`).

use serde::Deserialize;
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::{JsError, wasm_bindgen};
use wf_core::overleaf::export_path;

/// Throws unless `path` is a plain relative ZIP entry name: no `..`, no leading `/`, no `\`.
///
/// # Errors
///
/// Fails with the refusal message of
/// [`unsafe_export_path_error`](export_path::unsafe_export_path_error) when the path is unsafe.
#[wasm_bindgen(js_name = assertSafeExportPath)]
pub fn assert_safe_export_path(path: &str) -> Result<(), JsError> {
    match export_path::unsafe_export_path_error(path) {
        Some(message) => Err(JsError::new(&message)),
        None => Ok(()),
    }
}

/// The figure a warning names: its path in the ZIP and its storage path.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MissingFigure {
    zip_path: String,
    storage_path: String,
}

/// [`missing_figure_warning`](export_path::missing_figure_warning): the warning for a figure whose
/// blob could not be loaded.
///
/// # Errors
///
/// Fails if `img` is not a `{ zipPath, storagePath }` object.
#[wasm_bindgen(js_name = missingFigureWarning)]
pub fn missing_figure_warning(
    #[wasm_bindgen(unchecked_param_type = "{ zipPath: string; storagePath: string }")] img: JsValue,
) -> Result<String, serde_wasm_bindgen::Error> {
    let img: MissingFigure = serde_wasm_bindgen::from_value(img)?;
    Ok(export_path::missing_figure_warning(
        &img.zip_path,
        &img.storage_path,
    ))
}
