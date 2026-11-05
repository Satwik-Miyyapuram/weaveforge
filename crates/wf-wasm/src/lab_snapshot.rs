//! Lab snapshot content for JavaScript (wf-core `lab_snapshot`). The JS name
//! matches `packages/core/src/features/org/domain/lab-snapshot.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::lab_snapshot::{self, BuildLabSnapshotInput};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`build_lab_snapshot_content`](lab_snapshot::build_lab_snapshot_content).
///
/// # Errors
///
/// Fails if `input` has the wrong shape.
#[wasm_bindgen(js_name = buildLabSnapshotContent)]
pub fn build_lab_snapshot_content_js(input: JsValue) -> JsResult<JsValue> {
    let input: BuildLabSnapshotInput = serde_wasm_bindgen::from_value(input)?;
    to_js(&lab_snapshot::build_lab_snapshot_content(input))
}
