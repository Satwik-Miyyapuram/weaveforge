//! Dashboard grid packing and fitted list-card heights for JavaScript (wf-core `dashboard::packing`,
//! `dashboard::fit`). Each export takes the card size limits as data. An unknown card type throws,
//! as the old TS `getCardDef` did.

use std::collections::HashMap;

use js_sys::{Array, Object, Reflect};
use wasm_bindgen::prelude::{JsError, wasm_bindgen};
use wasm_bindgen::{JsCast, JsValue};
use wf_core::dashboard::fit;
use wf_core::dashboard::packing::{self, CardLimit, LayoutItem};

use super::to_js;

/// A thrown `Error` with the message; a bare string would reach JS without a name or stack.
fn js_error(error: impl std::fmt::Display) -> JsError {
    JsError::new(&error.to_string())
}

fn js(value: &impl serde::Serialize) -> Result<JsValue, JsError> {
    to_js(value).map_err(js_error)
}

/// [`floors`](packing::floors) for one card type on a grid `cols` wide.
///
/// # Errors
///
/// Fails if `limit` is not a card limit.
#[wasm_bindgen(
    js_name = dashboardLayoutFloors,
    unchecked_return_type = "{ minW: number; minH: number; maxW: number; maxH: number }"
)]
pub fn dashboard_layout_floors_js(
    #[wasm_bindgen(unchecked_param_type = "B.CardLimit")] limit: JsValue,
    cols: f64,
) -> Result<JsValue, JsError> {
    let limit: CardLimit = serde_wasm_bindgen::from_value(limit).map_err(js_error)?;
    js(&packing::floors(&limit, cols))
}

/// [`normalize_item`](packing::normalize_item).
///
/// # Errors
///
/// Fails on a bad input shape or an unknown card type.
#[wasm_bindgen(js_name = dashboardNormalizeItem, unchecked_return_type = "B.LayoutItem")]
pub fn dashboard_normalize_item_js(
    #[wasm_bindgen(unchecked_param_type = "B.LayoutItem")] item: JsValue,
    #[wasm_bindgen(unchecked_param_type = "readonly B.CardLimit[]")] limits: JsValue,
    cols: f64,
) -> Result<JsValue, JsError> {
    let item: LayoutItem = serde_wasm_bindgen::from_value(item).map_err(js_error)?;
    let limits: Vec<CardLimit> = serde_wasm_bindgen::from_value(limits).map_err(js_error)?;
    let out = packing::normalize_item(&item, &limits, cols).map_err(js_error)?;
    js(&out)
}

/// [`compact_vertical`](packing::compact_vertical).
///
/// # Errors
///
/// Fails on a bad input shape.
#[wasm_bindgen(js_name = dashboardCompactVertical, unchecked_return_type = "B.LayoutItem[]")]
pub fn dashboard_compact_vertical_js(
    #[wasm_bindgen(unchecked_param_type = "readonly B.LayoutItem[]")] items: JsValue,
    cols: f64,
) -> Result<JsValue, JsError> {
    let items: Vec<LayoutItem> = serde_wasm_bindgen::from_value(items).map_err(js_error)?;
    js(&packing::compact_vertical(&items, cols))
}

/// [`pack_sm`](packing::pack_sm).
///
/// # Errors
///
/// Fails on a bad input shape or an unknown card type.
#[wasm_bindgen(js_name = dashboardPackSm, unchecked_return_type = "B.LayoutItem[]")]
pub fn dashboard_pack_sm_js(
    #[wasm_bindgen(unchecked_param_type = "readonly B.LayoutItem[]")] items: JsValue,
    #[wasm_bindgen(unchecked_param_type = "readonly B.CardLimit[]")] limits: JsValue,
) -> Result<JsValue, JsError> {
    let items: Vec<LayoutItem> = serde_wasm_bindgen::from_value(items).map_err(js_error)?;
    let limits: Vec<CardLimit> = serde_wasm_bindgen::from_value(limits).map_err(js_error)?;
    let out = packing::pack_sm(&items, &limits).map_err(js_error)?;
    js(&out)
}

/// [`close_gaps`](packing::close_gaps).
///
/// # Errors
///
/// Fails on a bad input shape or an unknown card type.
#[wasm_bindgen(js_name = dashboardCloseGaps, unchecked_return_type = "B.LayoutItem[]")]
pub fn dashboard_close_gaps_js(
    #[wasm_bindgen(unchecked_param_type = "readonly B.LayoutItem[]")] items: JsValue,
    #[wasm_bindgen(unchecked_param_type = "readonly B.CardLimit[]")] limits: JsValue,
    cols: f64,
) -> Result<JsValue, JsError> {
    let items: Vec<LayoutItem> = serde_wasm_bindgen::from_value(items).map_err(js_error)?;
    let limits: Vec<CardLimit> = serde_wasm_bindgen::from_value(limits).map_err(js_error)?;
    let out = packing::close_gaps(&items, &limits, cols).map_err(js_error)?;
    js(&out)
}

/// [`rows_for_height`](fit::rows_for_height): grid rows that show `px` of card.
#[wasm_bindgen(js_name = rowsForHeight)]
pub fn rows_for_height_js(px: f64, row_height: f64, margin: f64) -> f64 {
    fit::rows_for_height(px, row_height, margin)
}

/// [`fit_layout_to_content`](fit::fit_layout_to_content). `measured` and `maxHeights` map a card id
/// (or card type) to rows; only card types in `maxHeights` fit their content. `measured` is a JS
/// `Map` (a plain object also works).
///
/// # Errors
///
/// Fails when an argument is not the expected shape.
#[wasm_bindgen(js_name = fitLayoutToContent, unchecked_return_type = "B.LayoutItem[]")]
pub fn fit_layout_to_content_js(
    #[wasm_bindgen(unchecked_param_type = "readonly B.LayoutItem[]")] items: JsValue,
    #[wasm_bindgen(unchecked_param_type = "ReadonlyMap<string, number>")] measured: JsValue,
    #[wasm_bindgen(unchecked_param_type = "Readonly<Record<string, number>>")] max_heights: JsValue,
) -> Result<JsValue, JsError> {
    let items: Vec<LayoutItem> = serde_wasm_bindgen::from_value(items).map_err(js_error)?;
    let measured: HashMap<String, f64> =
        serde_wasm_bindgen::from_value(measured).map_err(js_error)?;
    let max_heights: HashMap<String, f64> =
        serde_wasm_bindgen::from_value(max_heights).map_err(js_error)?;
    js(&fit::fit_layout_to_content(&items, &measured, &max_heights))
}

/// The generic signature of [`stored_heights_js`], which wasm-bindgen cannot express.
#[wasm_bindgen(typescript_custom_section)]
const WITH_STORED_HEIGHTS_TS: &str = r"
/** Each position's height, with the saved height put back where the card has one. */
export function withStoredHeights<T extends { i: string; h: number }>(
  rgl: readonly T[],
  stored: readonly B.LayoutItem[],
): T[];
";

/// [`stored_heights`](fit::stored_heights) over grid positions: a shallow copy of each position
/// (`{ ...r, h }`) with its height replaced by the card's saved height where it has one.
///
/// # Errors
///
/// Fails when an argument is not the expected shape.
#[wasm_bindgen(js_name = withStoredHeights, skip_typescript)]
pub fn stored_heights_js(rgl: &Array, stored: JsValue) -> Result<Array, JsError> {
    let i_key = JsValue::from_str("i");
    let h_key = JsValue::from_str("h");
    let mut ids = Vec::new();
    let mut heights = Vec::new();
    for row in rgl.iter() {
        let id = Reflect::get(&row, &i_key).map_err(|_| js_error("cannot read `i`"))?;
        let h = Reflect::get(&row, &h_key).map_err(|_| js_error("cannot read `h`"))?;
        ids.push(id.as_string().unwrap_or_default());
        heights.push(h.as_f64().unwrap_or(f64::NAN));
    }
    let stored: Vec<LayoutItem> = serde_wasm_bindgen::from_value(stored).map_err(js_error)?;
    let out = Array::new();
    for (row, h) in rgl.iter().zip(fit::stored_heights(&ids, &heights, &stored)) {
        let copy = Object::assign(&Object::new(), row.unchecked_ref());
        let _ = Reflect::set(&copy, &h_key, &JsValue::from_f64(h))
            .map_err(|_| js_error("cannot set `h`"))?;
        let _ = out.push(&copy);
    }
    Ok(out)
}
