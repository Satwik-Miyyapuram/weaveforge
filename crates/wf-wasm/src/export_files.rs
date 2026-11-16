//! User-data export file pieces for JavaScript (wf-core `export_files`). The TS wrapper in
//! `packages/wf-wasm/src/export-files.ts` applies the types.

use serde::de::DeserializeOwned;
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::export_files::{ExportStats, export_asset_path, export_manifest_json, export_readme};

fn parse<T: DeserializeOwned>(value: JsValue) -> Result<T, wasm_bindgen::JsError> {
    serde_wasm_bindgen::from_value(value)
        .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))
}

/// [`export_manifest_json`]: the export's `manifest.json` text.
#[wasm_bindgen(js_name = exportManifestJson)]
pub fn export_manifest_json_js(
    exported_at: &str,
    #[wasm_bindgen(unchecked_param_type = "B.ExportStats")] stats: JsValue,
) -> Result<String, wasm_bindgen::JsError> {
    let stats: ExportStats = parse(stats)?;
    Ok(export_manifest_json(exported_at, &stats))
}

/// [`export_readme`]: the export's `README.txt` text.
#[wasm_bindgen(js_name = exportReadme)]
#[must_use]
pub fn export_readme_js(exported_at: &str) -> String {
    export_readme(exported_at)
}

/// [`export_asset_path`]: the folder a stored asset is written to in the export.
#[wasm_bindgen(js_name = exportAssetPath)]
#[must_use]
pub fn export_asset_path_js(root: &str, prefix: &str, storage_path: &str) -> String {
    export_asset_path(root, prefix, storage_path)
}
