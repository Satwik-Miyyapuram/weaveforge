//! Folder mirror manifest text for JavaScript (wf-core `workspace::mirror_manifest`).

use std::collections::BTreeMap;

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::sync::merge_vault_page::VaultPageBase;
use wf_core::workspace::mirror_manifest;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`manifest_text`](mirror_manifest::manifest_text) on `paths`, `digests`, `bases` and the stamp.
///
/// # Errors
///
/// Fails if the inputs do not match the shape.
#[wasm_bindgen(js_name = mirrorManifestText)]
pub fn mirror_manifest_text_js(
    #[wasm_bindgen(unchecked_param_type = "readonly string[]")] paths: JsValue,
    #[wasm_bindgen(unchecked_param_type = "Readonly<Record<string, string>>")] digests: JsValue,
    #[wasm_bindgen(unchecked_param_type = "Readonly<Record<string, unknown>>")] bases: JsValue,
    written_at: &str,
) -> JsResult<String> {
    let paths: Vec<String> = serde_wasm_bindgen::from_value(paths)?;
    let digests: BTreeMap<String, String> = serde_wasm_bindgen::from_value(digests)?;
    let bases: BTreeMap<String, VaultPageBase> = serde_wasm_bindgen::from_value(bases)?;
    Ok(mirror_manifest::manifest_text(&paths, &digests, &bases, written_at))
}

/// [`same_manifest_ignoring_stamp`](mirror_manifest::same_manifest_ignoring_stamp).
#[wasm_bindgen(js_name = sameManifestIgnoringStamp)]
#[must_use]
pub fn same_manifest_ignoring_stamp_js(current: &str, next: &str) -> bool {
    mirror_manifest::same_manifest_ignoring_stamp(current, next)
}
