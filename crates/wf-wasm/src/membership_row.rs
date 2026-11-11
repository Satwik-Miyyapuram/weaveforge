//! Org membership row mapping for JavaScript (wf-core `membership_row`). The TS wrapper in
//! `packages/wf-wasm/src/wrappers-4.ts` applies the types.

use serde::de::DeserializeOwned;
use wasm_bindgen::prelude::wasm_bindgen;
use wasm_bindgen::{JsError, JsValue};
use wf_core::membership_row::{MembershipRow, to_view};

use super::to_js;

fn parse<T: DeserializeOwned>(value: JsValue) -> Result<T, JsError> {
    serde_wasm_bindgen::from_value(value).map_err(|error| JsError::new(&error.to_string()))
}

#[allow(clippy::needless_pass_by_value)] // `map_err` hands the error over by value.
fn js_error(error: serde_wasm_bindgen::Error) -> JsError {
    JsError::new(&error.to_string())
}

/// [`to_view`]: an `org_memberships` row with its embedded organisation as a membership view.
#[wasm_bindgen(js_name = membershipViewFromRow)]
pub fn membership_view_from_row_js(row: JsValue) -> Result<JsValue, JsError> {
    let row: MembershipRow = parse(row)?;
    to_js(&to_view(&row)).map_err(js_error)
}
