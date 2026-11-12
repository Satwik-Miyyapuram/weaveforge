//! Local attachment store SQL and decisions for JavaScript (wf-core
//! `sync::local_blob_plan`). The JS names are called from
//! `apps/web/src/backend/providers/local/parts-1.ts`.

use wasm_bindgen::JsError;
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::sync::local_blob_plan::{
    blob_read_sql, blob_sql, merge_signed_urls, missing_paths, removal_forgets_unsent_upload,
    unsigned_indices,
};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`blob_sql`] for JS: the statement with this name. Fails for an unknown name.
///
/// # Errors
///
/// Fails when `name` is not a statement of the local attachment store.
#[wasm_bindgen(js_name = localBlobSql)]
pub fn local_blob_sql_js(name: &str) -> Result<String, JsError> {
    blob_sql(name)
        .map(str::to_owned)
        .ok_or_else(|| JsError::new(&format!("unknown local blob statement: {name}")))
}

/// [`blob_read_sql`] for JS: the read statement for `path_count` paths.
#[wasm_bindgen(js_name = localBlobReadSql)]
#[must_use]
pub fn local_blob_read_sql_js(path_count: u32) -> String {
    blob_read_sql(path_count as usize)
}

/// [`removal_forgets_unsent_upload`] for JS: whether a removal forgets a queued upload.
#[wasm_bindgen(js_name = localBlobRemovalForgetsUpload)]
#[must_use]
pub fn local_blob_removal_forgets_upload_js(pending_op: Option<String>) -> bool {
    removal_forgets_unsent_upload(pending_op.as_deref())
}

/// [`missing_paths`] for JS: the paths not in `have`, in order.
///
/// # Errors
///
/// Fails when either argument is not an array of strings.
#[wasm_bindgen(js_name = localBlobMissingPaths, unchecked_return_type = "string[]")]
pub fn local_blob_missing_paths_js(
    #[wasm_bindgen(unchecked_param_type = "readonly string[]")] paths: JsValue,
    #[wasm_bindgen(unchecked_param_type = "readonly string[]")] have: JsValue,
) -> JsResult<JsValue> {
    let paths: Vec<String> = serde_wasm_bindgen::from_value(paths)?;
    let have: Vec<String> = serde_wasm_bindgen::from_value(have)?;
    to_js(&missing_paths(&paths, &have))
}

/// [`merge_signed_urls`] for JS: this computer's links win, the server fills the gaps.
///
/// # Errors
///
/// Fails when an argument is not an array of strings or nulls.
#[wasm_bindgen(js_name = localBlobMergeSignedUrls, unchecked_return_type = "(string | null)[]")]
pub fn local_blob_merge_signed_urls_js(
    #[wasm_bindgen(unchecked_param_type = "readonly string[]")] paths: JsValue,
    #[wasm_bindgen(unchecked_param_type = "readonly (string | null | undefined)[]")] here: JsValue,
    #[wasm_bindgen(unchecked_param_type = "readonly (string | null | undefined)[]")] there: JsValue,
) -> JsResult<JsValue> {
    let paths: Vec<String> = serde_wasm_bindgen::from_value(paths)?;
    let here: Vec<Option<String>> = serde_wasm_bindgen::from_value(here)?;
    let there: Vec<Option<String>> = serde_wasm_bindgen::from_value(there)?;
    to_js(&merge_signed_urls(&paths, &here, &there))
}

/// [`unsigned_indices`] for JS: the positions whose link this computer lacks (`null`), in order.
///
/// # Errors
///
/// Fails when `here` is not an array of strings or nulls.
#[wasm_bindgen(js_name = localBlobUnsignedIndices, unchecked_return_type = "number[]")]
pub fn local_blob_unsigned_indices_js(
    #[wasm_bindgen(unchecked_param_type = "readonly (string | null | undefined)[]")] here: JsValue,
) -> JsResult<JsValue> {
    let here: Vec<Option<String>> = serde_wasm_bindgen::from_value(here)?;
    to_js(&unsigned_indices(&here))
}
