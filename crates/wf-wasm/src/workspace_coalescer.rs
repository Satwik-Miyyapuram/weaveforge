//! Folder mirror sync coalescer step for JavaScript (wf-core `workspace::coalescer`).

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::workspace::coalescer::{self, CoalescerEvent, CoalescerState};

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`step`](coalescer::step): the next `{ state, actions }` for one `event` from `state`.
///
/// # Errors
///
/// Fails if `state` or `event` does not match the coalescer shape.
#[wasm_bindgen(
    js_name = coalescerStep,
    unchecked_return_type = "{ state: { suspended: boolean; timerArmed: boolean; inFlight: boolean; again: boolean }; actions: ({ type: 'clearTimer' } | { type: 'armTimer' } | { type: 'startRun' })[] }"
)]
pub fn coalescer_step_js(
    #[wasm_bindgen(
        unchecked_param_type = "{ suspended: boolean; timerArmed: boolean; inFlight: boolean; again: boolean }"
    )]
    state: JsValue,
    #[wasm_bindgen(
        unchecked_param_type = "{ type: 'request' | 'cancel' | 'timerFired' | 'runSettled' } | { type: 'suspend'; value: boolean }"
    )]
    event: JsValue,
) -> JsResult<JsValue> {
    let state: CoalescerState = serde_wasm_bindgen::from_value(state)?;
    let event: CoalescerEvent = serde_wasm_bindgen::from_value(event)?;
    serde_wasm_bindgen::to_value(&coalescer::step(&state, &event))
}
