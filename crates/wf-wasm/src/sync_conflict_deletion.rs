//! Delete-conflict choice for JavaScript (wf-core `sync::conflict_deletion`). The JS name matches
//! `deletionFor` in `packages/wf-wasm/src/sync-conflict-deletion.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::sync::conflict_deletion::{DeleteConflictKind, PickSide, deletion_for};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`deletion_for`] (TS `deletionFor`). `kind` is `"deleted_remote"` or `"deleted_local"`,
/// `side` is `"local"` or `"remote"`; returns `"keep"` or `"delete"`.
///
/// # Errors
///
/// Fails if `kind` or `side` is not one of those strings.
#[wasm_bindgen(js_name = deletionFor, unchecked_return_type = "\"keep\" | \"delete\"")]
pub fn deletion_for_js(
    #[wasm_bindgen(unchecked_param_type = "\"deleted_remote\" | \"deleted_local\"")] kind: JsValue,
    #[wasm_bindgen(unchecked_param_type = "\"local\" | \"remote\"")] side: JsValue,
) -> JsResult<JsValue> {
    let kind: DeleteConflictKind = serde_wasm_bindgen::from_value(kind)?;
    let side: PickSide = serde_wasm_bindgen::from_value(side)?;
    to_js(&deletion_for(kind, side))
}
