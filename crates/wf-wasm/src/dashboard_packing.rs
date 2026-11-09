//! Dashboard grid packing for JavaScript (wf-core `dashboard::packing`). Each export takes the
//! card size limits as data. An unknown card type throws, as the old TS `getCardDef` did.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::dashboard::packing::{self, CardLimit, LayoutItem};

use super::to_js;

/// [`floors`](packing::floors) for one card type on a grid `cols` wide.
///
/// # Errors
///
/// Fails if `limit` is not a card limit.
#[wasm_bindgen(js_name = dashboardLayoutFloors)]
pub fn dashboard_layout_floors_js(
    limit: JsValue,
    cols: f64,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let limit: CardLimit = serde_wasm_bindgen::from_value(limit)?;
    to_js(&packing::floors(&limit, cols))
}

/// [`normalize_item`](packing::normalize_item).
///
/// # Errors
///
/// Fails on a bad input shape or an unknown card type.
#[wasm_bindgen(js_name = dashboardNormalizeItem)]
pub fn dashboard_normalize_item_js(
    item: JsValue,
    limits: JsValue,
    cols: f64,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let item: LayoutItem = serde_wasm_bindgen::from_value(item)?;
    let limits: Vec<CardLimit> = serde_wasm_bindgen::from_value(limits)?;
    let out =
        packing::normalize_item(&item, &limits, cols).map_err(serde_wasm_bindgen::Error::new)?;
    to_js(&out)
}

/// [`compact_vertical`](packing::compact_vertical).
///
/// # Errors
///
/// Fails on a bad input shape.
#[wasm_bindgen(js_name = dashboardCompactVertical)]
pub fn dashboard_compact_vertical_js(
    items: JsValue,
    cols: f64,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let items: Vec<LayoutItem> = serde_wasm_bindgen::from_value(items)?;
    to_js(&packing::compact_vertical(&items, cols))
}

/// [`pack_sm`](packing::pack_sm).
///
/// # Errors
///
/// Fails on a bad input shape or an unknown card type.
#[wasm_bindgen(js_name = dashboardPackSm)]
pub fn dashboard_pack_sm_js(
    items: JsValue,
    limits: JsValue,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let items: Vec<LayoutItem> = serde_wasm_bindgen::from_value(items)?;
    let limits: Vec<CardLimit> = serde_wasm_bindgen::from_value(limits)?;
    let out = packing::pack_sm(&items, &limits).map_err(serde_wasm_bindgen::Error::new)?;
    to_js(&out)
}

/// [`close_gaps`](packing::close_gaps).
///
/// # Errors
///
/// Fails on a bad input shape or an unknown card type.
#[wasm_bindgen(js_name = dashboardCloseGaps)]
pub fn dashboard_close_gaps_js(
    items: JsValue,
    limits: JsValue,
    cols: f64,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let items: Vec<LayoutItem> = serde_wasm_bindgen::from_value(items)?;
    let limits: Vec<CardLimit> = serde_wasm_bindgen::from_value(limits)?;
    let out = packing::close_gaps(&items, &limits, cols).map_err(serde_wasm_bindgen::Error::new)?;
    to_js(&out)
}
