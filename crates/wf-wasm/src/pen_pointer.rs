//! Pen eraser and barrel detection for JavaScript (wf-core `ink::pen_pointer`).

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::ink::pen_pointer;

/// [`is_pen_eraser_pointer`](pen_pointer::is_pen_eraser_pointer): whether a pointer
/// event is the pen's eraser end.
#[wasm_bindgen(js_name = isPenEraserPointer)]
pub fn is_pen_eraser_pointer_js(
    pointer_type: &str,
    button: Option<f64>,
    buttons: Option<f64>,
) -> bool {
    pen_pointer::is_pen_eraser_pointer(pointer_type, button, buttons)
}

/// [`is_pen_barrel_pointer`](pen_pointer::is_pen_barrel_pointer): whether a pen touched
/// down with its barrel button held.
#[wasm_bindgen(js_name = isPenBarrelPointer)]
pub fn is_pen_barrel_pointer_js(
    pointer_type: &str,
    button: Option<f64>,
    buttons: Option<f64>,
) -> bool {
    pen_pointer::is_pen_barrel_pointer(pointer_type, button, buttons)
}
