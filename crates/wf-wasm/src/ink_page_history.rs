//! Per-page undo log for ink (DA-113) for JavaScript. Each export wraps a
//! `wf_core::ink::page_history` function; the history crosses as a plain
//! object shaped like `PageHistory` in `bindings.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::ink::figure::FigurePlacement;
use wf_core::ink::page_history::{
    PageDirection, PageHistory, empty_page_history, push_figure_step, sync_stroke_steps,
    take_page_step,
};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

fn parse_history(history: JsValue) -> JsResult<PageHistory> {
    serde_wasm_bindgen::from_value(history)
}

fn parse_figures(figures: JsValue) -> JsResult<Vec<FigurePlacement>> {
    serde_wasm_bindgen::from_value(figures)
}

fn parse_direction(direction: &str) -> PageDirection {
    if direction == "redo" {
        PageDirection::Redo
    } else {
        PageDirection::Undo
    }
}

/// [`empty_page_history`] as `{ undo: [], redo: [] }`.
#[wasm_bindgen(js_name = emptyPageHistory)]
pub fn empty_page_history_js() -> JsResult<JsValue> {
    to_js(&empty_page_history())
}

/// [`sync_stroke_steps`]: `history` is the page log, `depth` the worker's stroke count.
#[wasm_bindgen(js_name = syncStrokeSteps)]
pub fn sync_stroke_steps_js(history: JsValue, depth: u32) -> JsResult<JsValue> {
    let history = parse_history(history)?;
    to_js(&sync_stroke_steps(&history, depth as usize))
}

/// [`push_figure_step`]: `before` and `after` are the page's figure arrays;
/// `key` is the press number, or `null` when the edit is not from a press.
#[wasm_bindgen(js_name = pushFigureStep)]
pub fn push_figure_step_js(
    history: JsValue,
    before: JsValue,
    after: JsValue,
    key: JsValue,
) -> JsResult<JsValue> {
    let history = parse_history(history)?;
    let before = parse_figures(before)?;
    let after = parse_figures(after)?;
    let key: Option<f64> = serde_wasm_bindgen::from_value(key)?;
    to_js(&push_figure_step(&history, before, after, key))
}

/// [`take_page_step`]: `direction` is `"undo"` or `"redo"`; gives
/// `{ history, step }`, or `null` when that stack is empty.
#[wasm_bindgen(js_name = takePageStep)]
pub fn take_page_step_js(history: JsValue, direction: &str) -> JsResult<JsValue> {
    let history = parse_history(history)?;
    to_js(&take_page_step(&history, parse_direction(direction)))
}
