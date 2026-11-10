//! Folder sync report line for JavaScript (wf-core `workspace::sync_report`). The JS name
//! matches `packages/wf-wasm/src/workspace-sync-report.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::workspace::sync_report::{SyncReport, describe_sync};

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`describe_sync`]: the one line the panel shows after a folder sync.
///
/// # Errors
///
/// Fails if `report` is not `{ written, removed, commitMessage?, commitError? }`.
#[wasm_bindgen(js_name = describeSync)]
pub fn describe_sync_js(report: JsValue) -> JsResult<String> {
    let report: SyncReport = serde_wasm_bindgen::from_value(report)?;
    Ok(describe_sync(&report))
}
