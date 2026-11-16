//! Project row mapping for JavaScript (wf-core `project_row`). The TS wrapper in
//! `packages/wf-wasm/src/project-row.ts` applies the types.

use serde::de::DeserializeOwned;
use wasm_bindgen::prelude::wasm_bindgen;
use wasm_bindgen::{JsError, JsValue};
use wf_core::project_row::{ProjectRow, to_project};

use super::to_js;

fn parse<T: DeserializeOwned>(value: JsValue) -> Result<T, JsError> {
    serde_wasm_bindgen::from_value(value).map_err(|error| JsError::new(&error.to_string()))
}

#[allow(clippy::needless_pass_by_value)] // `map_err` hands the error over by value.
fn js_error(error: serde_wasm_bindgen::Error) -> JsError {
    JsError::new(&error.to_string())
}

/// [`to_project`]: a `projects` row as the app's project.
#[wasm_bindgen(js_name = projectFromRow, unchecked_return_type = "B.Project")]
pub fn project_from_row_js(
    #[wasm_bindgen(unchecked_param_type = "B.ProjectRow")] row: JsValue,
) -> Result<JsValue, JsError> {
    let row: ProjectRow = parse(row)?;
    to_js(&to_project(&row)).map_err(js_error)
}
