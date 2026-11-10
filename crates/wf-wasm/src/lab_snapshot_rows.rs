//! Lab snapshot row mapping for JavaScript (wf-core `lab_snapshot_rows`). The TS wrapper in
//! `packages/wf-wasm/src/lab-snapshot-rows.ts` applies the types.

use serde::de::DeserializeOwned;
use wasm_bindgen::prelude::wasm_bindgen;
use wasm_bindgen::{JsError, JsValue};
use wf_core::lab_snapshot_rows::{LabSnapshotRow, to_domain};

use super::to_js;

fn parse<T: DeserializeOwned>(value: JsValue) -> Result<T, JsError> {
    serde_wasm_bindgen::from_value(value).map_err(|error| JsError::new(&error.to_string()))
}

#[allow(clippy::needless_pass_by_value)] // `map_err` hands the error over by value.
fn js_error(error: serde_wasm_bindgen::Error) -> JsError {
    JsError::new(&error.to_string())
}

/// [`to_domain`]: a `lab_snapshots` row as a published snapshot.
#[wasm_bindgen(js_name = labSnapshotRowToDomain)]
pub fn lab_snapshot_row_to_domain_js(row: JsValue) -> Result<JsValue, JsError> {
    let row: LabSnapshotRow = parse(row)?;
    to_js(&to_domain(&row)).map_err(js_error)
}
