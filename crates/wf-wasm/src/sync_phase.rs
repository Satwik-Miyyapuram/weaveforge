//! Sync phase rules for JavaScript (wf-core `sync::sync_phase`). The JS names match
//! `packages/wf-wasm/src/sync-phase.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::sync::sync_phase::{after_cycle, after_failure, initial_phase, is_caught_up};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`after_cycle`]: the phase a finished cycle leaves. `stopped_because` is the push's stop reason, or null.
///
/// # Errors
///
/// Fails if the result cannot be serialised.
#[wasm_bindgen(js_name = afterCycle, unchecked_return_type = "{ phase: \"idle\" | \"offline\" | \"error\"; isOnline: boolean }")]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn after_cycle_js(stopped_because: Option<String>) -> JsResult<JsValue> {
    to_js(&after_cycle(stopped_because.as_deref()))
}

/// [`after_failure`]: the phase a cycle that threw leaves.
///
/// # Errors
///
/// Fails if the result cannot be serialised.
#[wasm_bindgen(js_name = afterFailure, unchecked_return_type = "{ phase: \"idle\" | \"offline\" | \"error\"; isOnline: boolean }")]
pub fn after_failure_js(online: bool) -> JsResult<JsValue> {
    to_js(&after_failure(online))
}

/// [`is_caught_up`]: whether a pass ran to the end with no more pages to pull.
#[wasm_bindgen(js_name = isCaughtUp)]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn is_caught_up_js(stopped_because: Option<String>, pulled_more: bool) -> bool {
    is_caught_up(stopped_because.as_deref(), pulled_more)
}

/// [`initial_phase`]: the phase before the first cycle.
///
/// # Errors
///
/// Fails if the result cannot be serialised.
#[wasm_bindgen(js_name = initialPhase, unchecked_return_type = "\"idle\" | \"offline\" | \"error\"")]
pub fn initial_phase_js(online: bool) -> JsResult<JsValue> {
    to_js(&initial_phase(online))
}
