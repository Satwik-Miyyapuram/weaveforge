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
#[wasm_bindgen(js_name = buildLabSnapshotContent, unchecked_return_type = "B.LabSnapshotContent")]
pub fn build_lab_snapshot_content_js(
    #[wasm_bindgen(
        unchecked_param_type = "{ milestones: B.MilestoneInput[]; logs: B.LogEntryInput[]; experiments: B.ExperimentInput[]; report: B.ReportSectionInput[]; aiAssisted?: number }"
    )]
    input: JsValue,
) -> JsResult<JsValue> {
    let input: BuildLabSnapshotInput = serde_wasm_bindgen::from_value(input)?;
    to_js(&lab_snapshot::build_lab_snapshot_content(input))
}

/// [`validate_snapshot_title`](lab_snapshot::validate_snapshot_title). Throws on a blank title.
#[wasm_bindgen(js_name = validateSnapshotTitle, unchecked_return_type = "string")]
pub fn validate_snapshot_title_js(title: &str) -> Result<String, JsValue> {
    lab_snapshot::validate_snapshot_title(title).map_err(JsValue::from_str)
}
