//! Experiment row mapping for JavaScript (wf-core `experiment_rows`). The TS wrapper in
//! `packages/wf-wasm/src/experiment-rows.ts` applies the types.

use serde::de::DeserializeOwned;
use wasm_bindgen::prelude::wasm_bindgen;
use wasm_bindgen::{JsError, JsValue};
use wf_core::experiment_rows::{ExperimentRow, to_domain, to_row};
use wf_core::experiments::Experiment;

use super::to_js;

fn parse<T: DeserializeOwned>(value: JsValue) -> Result<T, JsError> {
    serde_wasm_bindgen::from_value(value).map_err(|error| JsError::new(&error.to_string()))
}

#[allow(clippy::needless_pass_by_value)] // `map_err` hands the error over by value.
fn js_error(error: serde_wasm_bindgen::Error) -> JsError {
    JsError::new(&error.to_string())
}

/// [`to_domain`]: an `experiments` row as an experiment.
#[wasm_bindgen(js_name = experimentRowToDomain)]
pub fn experiment_row_to_domain_js(row: JsValue) -> Result<JsValue, JsError> {
    let row: ExperimentRow = parse(row)?;
    to_js(&to_domain(&row)).map_err(js_error)
}

/// [`to_row`]: an experiment as the `experiments` row it is written as.
#[wasm_bindgen(js_name = experimentToRow)]
pub fn experiment_to_row_js(experiment: JsValue) -> Result<JsValue, JsError> {
    let experiment: Experiment = parse(experiment)?;
    to_js(&to_row(&experiment)).map_err(js_error)
}
