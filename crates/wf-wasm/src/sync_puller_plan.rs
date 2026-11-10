//! Pull decisions for the offline-sync `Puller`, for JavaScript (wf-core `sync::puller_plan`).
//! The JS names are `pullSummary`, `pullApplyStep`, `pullTombstoneStep`, `uniqueConstraintName`
//! and `isUniqueClash`, called from `apps/web/src/features/offline-sync/domain/puller.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::sync::puller_plan::{
    PullFacts, PullSummaryInput, apply_step, is_unique_clash, summarize_pull, tombstone_step,
    unique_constraint_name,
};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`summarize_pull`] for JS (TS `pullSummary`).
///
/// # Errors
///
/// Fails when `input` is not a pull summary input.
#[wasm_bindgen(js_name = pullSummary)]
pub fn pull_summary_js(input: JsValue) -> JsResult<JsValue> {
    let input: PullSummaryInput = serde_wasm_bindgen::from_value(input)?;
    to_js(&summarize_pull(&input))
}

/// [`apply_step`] for JS (TS `pullApplyStep`).
///
/// # Errors
///
/// Fails when `facts` is not a pull fact set.
#[wasm_bindgen(js_name = pullApplyStep)]
pub fn pull_apply_step_js(facts: JsValue) -> JsResult<JsValue> {
    let facts: PullFacts = serde_wasm_bindgen::from_value(facts)?;
    to_js(&apply_step(&facts))
}

/// [`tombstone_step`] for JS (TS `pullTombstoneStep`).
///
/// # Errors
///
/// Fails when `facts` is not a pull fact set.
#[wasm_bindgen(js_name = pullTombstoneStep)]
pub fn pull_tombstone_step_js(facts: JsValue) -> JsResult<JsValue> {
    let facts: PullFacts = serde_wasm_bindgen::from_value(facts)?;
    to_js(&tombstone_step(&facts))
}

/// [`unique_constraint_name`] for JS (TS `uniqueConstraintName`). `undefined` when no name is quoted.
#[wasm_bindgen(js_name = uniqueConstraintName)]
pub fn unique_constraint_name_js(message: &str) -> Option<String> {
    unique_constraint_name(message)
}

/// [`is_unique_clash`] for JS (TS `isUniqueClash`).
#[wasm_bindgen(js_name = isUniqueClash)]
pub fn is_unique_clash_js(message: &str) -> bool {
    is_unique_clash(message)
}
