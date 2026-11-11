//! Export path guard and missing-figure warning (wf-core `overleaf::export_path`). The TS wrapper
//! `packages/wf-wasm/src/wrappers-5.ts` turns the guard's message into a thrown error.

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::overleaf::export_path;

/// [`unsafe_export_path_error`](export_path::unsafe_export_path_error): the refusal message, or
/// `undefined` when the path is a safe relative ZIP entry name.
#[wasm_bindgen(js_name = assertSafeExportPath)]
#[must_use]
pub fn unsafe_export_path_error(path: &str) -> Option<String> {
    export_path::unsafe_export_path_error(path)
}

/// [`missing_figure_warning`](export_path::missing_figure_warning).
#[wasm_bindgen(js_name = missingFigureWarning)]
#[must_use]
pub fn missing_figure_warning(zip_path: &str, storage_path: &str) -> String {
    export_path::missing_figure_warning(zip_path, storage_path)
}
