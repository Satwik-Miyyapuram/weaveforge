//! Overleaf sync status line for JavaScript (wf-core `overleaf::sync_status`). The JS name matches
//! `apps/web/src/features/overleaf/application/parts.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::{JsError, wasm_bindgen};
use wf_core::overleaf::sync_status::{self, OverleafSyncStatus};

/// [`describe_overleaf_status`](sync_status::describe_overleaf_status): the one-line status, or `""`
/// when no status was given (`null` or `undefined`).
///
/// # Errors
///
/// Fails if the status is malformed.
#[wasm_bindgen(js_name = describeOverleafStatus)]
pub fn describe_overleaf_status_js(
    #[wasm_bindgen(unchecked_param_type = "B.OverleafSyncStatus | null | undefined")]
    status: JsValue,
) -> Result<String, JsError> {
    let status: Option<OverleafSyncStatus> =
        serde_wasm_bindgen::from_value(status).map_err(|error| JsError::new(&error.to_string()))?;
    Ok(sync_status::describe_overleaf_status(status.as_ref()))
}
