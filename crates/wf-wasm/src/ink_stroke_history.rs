//! The worker's stroke undo log for JavaScript (`ink::stroke_history`). One
//! dispatcher takes the stacks and a request, and gives the stacks back with the
//! action the page must apply. The stacks cross as a plain object shaped like
//! `StrokeHistory`; the buffer and renderer stay in TS.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::ink::stroke_history::{StrokeHistory, StrokeHistoryOp, stroke_history_step};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`stroke_history_step`]: `stacks` is `{ history, redone }`, `op` is
/// `{ op: "record", step } | { op: "undo" } | { op: "redo" }`. Gives
/// `{ stacks, action }`, where `action` is `{ op: "restore" | "erase" | "translate", indices, dx?, dy? }` or `null`.
///
/// # Errors
///
/// Fails if the stacks or the request do not have the expected shape.
#[wasm_bindgen(js_name = inkStrokeHistoryStep, unchecked_return_type = "{ stacks: { history: ({ kind: \"erase\" | \"draw\"; indices: number[] } | { kind: \"move\"; indices: number[]; dx: number; dy: number })[]; redone: ({ kind: \"erase\" | \"draw\"; indices: number[] } | { kind: \"move\"; indices: number[]; dx: number; dy: number })[] }; action: { op: \"restore\" | \"erase\" | \"translate\"; indices: number[]; dx?: number; dy?: number } | null }")]
pub fn ink_stroke_history_step_js(
    #[wasm_bindgen(unchecked_param_type = "{ history: ({ kind: \"erase\" | \"draw\"; indices: number[] } | { kind: \"move\"; indices: number[]; dx: number; dy: number })[]; redone: ({ kind: \"erase\" | \"draw\"; indices: number[] } | { kind: \"move\"; indices: number[]; dx: number; dy: number })[] }")] stacks: JsValue,
    #[wasm_bindgen(unchecked_param_type = "{ op: \"record\"; step: ({ kind: \"erase\" | \"draw\"; indices: number[] } | { kind: \"move\"; indices: number[]; dx: number; dy: number }) } | { op: \"undo\" } | { op: \"redo\" }")] op: JsValue,
) -> JsResult<JsValue> {
    let stacks: StrokeHistory = serde_wasm_bindgen::from_value(stacks)?;
    let op: StrokeHistoryOp = serde_wasm_bindgen::from_value(op)?;
    to_js(&stroke_history_step(stacks, op))
}
