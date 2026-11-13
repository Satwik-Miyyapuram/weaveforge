//! Sidebar reveal and right-click menu rules for JavaScript
//! (`wf_core::app_lib::{reveal_nav, context_menu}`).
//!
//! The TS side reads the DOM rectangles and keeps the menu items and listeners; these only decide.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::app_lib::context_menu::{self, Action, Point};
use wf_core::app_lib::reveal_nav::{self, Span};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`reveal_nav::scroll_top_to_reveal`] for JS: the `scrollTop` that shows the row whole.
#[must_use]
#[wasm_bindgen(js_name = navRevealScrollTop)]
pub fn nav_reveal_scroll_top(
    row_top: f64,
    row_bottom: f64,
    view_top: f64,
    view_bottom: f64,
    scroll_top: f64,
) -> f64 {
    reveal_nav::scroll_top_to_reveal(
        Span {
            top: row_top,
            bottom: row_bottom,
        },
        Span {
            top: view_top,
            bottom: view_bottom,
        },
        scroll_top,
    )
}

/// [`context_menu::reduce`] for JS: `{ state, accepted, changed }`.
///
/// `state` is `{ x, y }` or null; `action` is `{ kind: "open", x, y, count }` or `{ kind: "close" }`.
///
/// # Errors
///
/// Fails when `state` or `action` does not have the shape above.
#[wasm_bindgen(js_name = contextMenuReduce, unchecked_return_type = "unknown")]
pub fn context_menu_reduce(
    #[wasm_bindgen(unchecked_param_type = "unknown")] state: JsValue,
    #[wasm_bindgen(unchecked_param_type = "unknown")] action: JsValue,
) -> JsResult<JsValue> {
    let state: Option<Point> = serde_wasm_bindgen::from_value(state)?;
    let action: Action = serde_wasm_bindgen::from_value(action)?;
    to_js(&context_menu::reduce(state, action))
}

/// [`context_menu::place`] for JS: `{ x, y }` where the menu goes, padded from the viewport edge.
///
/// # Errors
///
/// Fails when the placement cannot be converted to a JS value.
#[wasm_bindgen(js_name = contextMenuPlace, unchecked_return_type = "unknown")]
pub fn context_menu_place(
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    view_width: f64,
    view_height: f64,
) -> JsResult<JsValue> {
    to_js(&context_menu::place(
        x,
        y,
        width,
        height,
        view_width,
        view_height,
    ))
}
