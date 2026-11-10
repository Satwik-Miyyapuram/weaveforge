//! Search palette hit order and the Space-to-preview key for JavaScript (wf-core `palette_sort`).

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::palette_groups::PaletteKey;
use wf_core::palette_sort::{self, HitKey, HitSort};

use super::to_js;

/// [`sort_hit_order`](palette_sort::sort_hit_order): the indices of `rows` in the chosen order.
///
/// # Errors
///
/// Fails if `rows` or `order` has the wrong shape.
#[wasm_bindgen(js_name = sortHitOrder)]
pub fn sort_hit_order_js(
    rows: JsValue,
    order: JsValue,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let rows: Vec<HitKey> = serde_wasm_bindgen::from_value(rows)?;
    let order: HitSort = serde_wasm_bindgen::from_value(order)?;
    to_js(&palette_sort::sort_hit_order(&rows, order))
}

/// [`is_preview_key`](palette_sort::is_preview_key): whether a key press opens the preview.
///
/// # Errors
///
/// Fails if `event` has the wrong shape.
#[wasm_bindgen(js_name = isPreviewKey)]
pub fn is_preview_key_js(
    #[wasm_bindgen(unchecked_param_type = "B.PaletteKey")] event: JsValue,
    in_text_box: bool,
) -> Result<bool, serde_wasm_bindgen::Error> {
    let event: PaletteKey = serde_wasm_bindgen::from_value(event)?;
    Ok(palette_sort::is_preview_key(&event, in_text_box))
}
