//! The GitLab log-file plan for JavaScript (wf-core `sync::gitlab_log_file`). The JS name
//! `gitlabLogFilePlan` is wrapped by `packages/wf-wasm/src/sync-gitlab-log-file.ts`, which
//! `features/sync/infrastructure/gitlab-log-exporter.ts` calls.

use serde_wasm_bindgen::Error;
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::sync::gitlab_log_file::{GitlabLogFileInput, gitlab_log_file_plan};

use super::to_js;

type JsResult<T> = Result<T, Error>;

/// [`gitlab_log_file_plan`] for JS (TS `gitlabLogFilePlan`).
///
/// # Errors
///
/// Fails when `input` is not a GitLab log file input with the expected fields.
#[wasm_bindgen(js_name = gitlabLogFilePlan, unchecked_return_type = "B.GitlabLogFilePlan")]
pub fn gitlab_log_file_plan_js(
    #[wasm_bindgen(unchecked_param_type = "B.GitlabLogFileInput")] input: JsValue,
) -> JsResult<JsValue> {
    let input: GitlabLogFileInput = serde_wasm_bindgen::from_value(input)?;
    to_js(&gitlab_log_file_plan(&input))
}
