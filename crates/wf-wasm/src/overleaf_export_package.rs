//! Overleaf export package steps for JavaScript (wf-core `overleaf_export_package`). The TS
//! wrapper in `packages/wf-wasm/src/wrappers-4.ts` applies the types.

use serde::de::DeserializeOwned;
use wasm_bindgen::prelude::wasm_bindgen;
use wasm_bindgen::{JsError, JsValue};
use wf_core::overleaf_export_package::{
    ExportFile, ExportImage, WalkOptions, walk_sections, with_missing_figures,
};
use wf_core::report::report_section::ReportSectionTreeNode;

use super::to_js;

fn parse<T: DeserializeOwned>(value: JsValue) -> Result<T, JsError> {
    serde_wasm_bindgen::from_value(value).map_err(|error| JsError::new(&error.to_string()))
}

#[allow(clippy::needless_pass_by_value)] // `map_err` hands the error over by value.
fn js_error(error: serde_wasm_bindgen::Error) -> JsError {
    JsError::new(&error.to_string())
}

/// [`walk_sections`] over the report outline: body lines, warnings, figures and counts.
#[wasm_bindgen(js_name = walkOverleafSections)]
pub fn walk_overleaf_sections(tree: JsValue, opts: JsValue) -> Result<JsValue, JsError> {
    let tree: Vec<ReportSectionTreeNode> = parse(tree)?;
    let opts: WalkOptions = parse(opts)?;
    to_js(&walk_sections(&tree, &opts)).map_err(js_error)
}

/// [`with_missing_figures`]: the package files with `manifest.json` rewritten for missing figures.
#[wasm_bindgen(js_name = withMissingFigures)]
pub fn overleaf_with_missing_figures(files: JsValue, missing: JsValue) -> Result<JsValue, JsError> {
    let files: Vec<ExportFile> = parse(files)?;
    let missing: Vec<ExportImage> = parse(missing)?;
    let out =
        with_missing_figures(&files, &missing).map_err(|error| JsError::new(&error.to_string()))?;
    to_js(&out).map_err(js_error)
}
