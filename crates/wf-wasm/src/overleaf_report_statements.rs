//! Overleaf link row statements for the desktop copy (wf-core `overleaf::report_statements`).

use wasm_bindgen::prelude::{JsError, JsValue, wasm_bindgen};
use wf_core::overleaf::report_statements::{self, CreateReport, PatchReport, Statement};

/// Turns a core statement into the `{ sql, params }` object the gateway runs.
fn statement_js(result: Result<Statement, String>) -> Result<JsValue, JsError> {
    let statement = result.map_err(|message| JsError::new(&message))?;
    serde_wasm_bindgen::to_value(&statement).map_err(|error| JsError::new(&error.to_string()))
}

/// [`create_report_statement`](report_statements::create_report_statement): the insert for a new
/// link row, with its bound parameters.
///
/// # Errors
///
/// Fails if `input` is not a create object, or with the refusal message for an invalid project id
/// or entry file.
#[wasm_bindgen(js_name = planOverleafReportCreate, unchecked_return_type = "{ sql: string; params: string[] }")]
pub fn plan_overleaf_report_create(
    #[wasm_bindgen(
        unchecked_param_type = "{ projectId: string; connectionId: string; title: string; overleafProjectId: string; entryFile: string }"
    )]
    input: JsValue,
) -> Result<JsValue, JsError> {
    let input: CreateReport =
        serde_wasm_bindgen::from_value(input).map_err(|error| JsError::new(&error.to_string()))?;
    statement_js(report_statements::create_report_statement(&input))
}

/// [`patch_report_statement`](report_statements::patch_report_statement): the update for one link
/// row, naming only the fields given.
///
/// # Errors
///
/// Fails if `input` is not a patch object, or with the refusal message for an invalid field or an
/// edit that names nothing.
#[wasm_bindgen(js_name = planOverleafReportPatch, unchecked_return_type = "{ sql: string; params: string[] }")]
pub fn plan_overleaf_report_patch(
    #[wasm_bindgen(
        unchecked_param_type = "{ id: string; title?: string; overleafProjectId?: string; entryFile?: string; sectionTargets?: unknown }"
    )]
    input: JsValue,
) -> Result<JsValue, JsError> {
    let input: PatchReport =
        serde_wasm_bindgen::from_value(input).map_err(|error| JsError::new(&error.to_string()))?;
    statement_js(report_statements::patch_report_statement(&input))
}
