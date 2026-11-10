//! Dashboard layout for JavaScript (wf-core `dashboard::layout`). The parse export's JS name
//! matches `packages/core/src/features/dashboard/domain/parse-dashboard-layout.ts`. The other
//! exports take the card size limits as data, and an unknown card type throws.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::{JsError, wasm_bindgen};
use wf_core::dashboard::layout::{self, DashboardLayout, RglPosition};
use wf_core::dashboard::packing::{CardLimit, LayoutItem};

use super::to_js;

/// A thrown `Error` with the message; a bare string would reach JS without a name or stack.
fn js_error(error: impl std::fmt::Display) -> JsError {
    JsError::new(&error.to_string())
}

fn js(value: &impl serde::Serialize) -> Result<JsValue, JsError> {
    to_js(value).map_err(js_error)
}

/// [`parse_dashboard_layout`](layout::parse_dashboard_layout); `null` when `lg` or `sm`
/// is not an array.
///
/// # Errors
///
/// Fails if `raw` cannot be read as JSON.
#[wasm_bindgen(js_name = parseDashboardLayout)]
pub fn parse_dashboard_layout_js(raw: JsValue) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let raw = if raw.is_undefined() {
        serde_json::Value::Null
    } else {
        serde_wasm_bindgen::from_value(raw)?
    };
    to_js(&layout::parse_dashboard_layout(&raw))
}

/// [`default_layout`](layout::default_layout): the supervisor or the student default.
///
/// # Errors
///
/// Fails if the result cannot be converted to a JS value.
#[wasm_bindgen(js_name = dashboardDefaultLayout)]
pub fn dashboard_default_layout_js(supervisor: bool) -> Result<JsValue, JsError> {
    js(&layout::default_layout(supervisor))
}

/// [`merge_supervisor_cards`](layout::merge_supervisor_cards). `ids` holds one new card id per
/// supervisor-only card type, in order.
///
/// # Errors
///
/// Fails on a bad input shape or an unknown card type.
#[wasm_bindgen(js_name = dashboardMergeSupervisorCards)]
pub fn dashboard_merge_supervisor_cards_js(
    layout_value: JsValue,
    limits: JsValue,
    ids: JsValue,
) -> Result<JsValue, JsError> {
    let layout_value: DashboardLayout =
        serde_wasm_bindgen::from_value(layout_value).map_err(js_error)?;
    let limits: Vec<CardLimit> = serde_wasm_bindgen::from_value(limits).map_err(js_error)?;
    let ids: Vec<String> = serde_wasm_bindgen::from_value(ids).map_err(js_error)?;
    js(&layout::merge_supervisor_cards(&layout_value, &limits, &ids).map_err(js_error)?)
}

/// [`append_card_pair`](layout::append_card_pair): append one card to both breakpoints.
///
/// # Errors
///
/// Fails on a bad input shape or an unknown card type.
#[wasm_bindgen(js_name = dashboardAppendCardPair)]
pub fn dashboard_append_card_pair_js(
    layout_value: JsValue,
    card_type: &str,
    id: &str,
    limits: JsValue,
) -> Result<JsValue, JsError> {
    let layout_value: DashboardLayout =
        serde_wasm_bindgen::from_value(layout_value).map_err(js_error)?;
    let limits: Vec<CardLimit> = serde_wasm_bindgen::from_value(limits).map_err(js_error)?;
    js(&layout::append_card_pair(&layout_value, card_type, id, &limits).map_err(js_error)?)
}

/// [`sync_dashboard_layouts`](layout::sync_dashboard_layouts).
///
/// # Errors
///
/// Fails on a bad input shape or an unknown card type.
#[wasm_bindgen(js_name = dashboardSyncLayouts)]
pub fn dashboard_sync_layouts_js(
    layout_value: JsValue,
    limits: JsValue,
) -> Result<JsValue, JsError> {
    let layout_value: DashboardLayout =
        serde_wasm_bindgen::from_value(layout_value).map_err(js_error)?;
    let limits: Vec<CardLimit> = serde_wasm_bindgen::from_value(limits).map_err(js_error)?;
    js(&layout::sync_dashboard_layouts(&layout_value, &limits).map_err(js_error)?)
}

/// [`finalize_dashboard_layout`](layout::finalize_dashboard_layout).
///
/// # Errors
///
/// Fails on a bad input shape or an unknown card type.
#[wasm_bindgen(js_name = dashboardFinalizeLayout)]
pub fn dashboard_finalize_layout_js(
    layout_value: JsValue,
    limits: JsValue,
) -> Result<JsValue, JsError> {
    let layout_value: DashboardLayout =
        serde_wasm_bindgen::from_value(layout_value).map_err(js_error)?;
    let limits: Vec<CardLimit> = serde_wasm_bindgen::from_value(limits).map_err(js_error)?;
    js(&layout::finalize_dashboard_layout(&layout_value, &limits).map_err(js_error)?)
}

/// [`merge_rgl_positions`](layout::merge_rgl_positions): the grid's positions, normalized to `cols`.
///
/// # Errors
///
/// Fails on a bad input shape or an unknown card type.
#[wasm_bindgen(js_name = dashboardMergeRglPositions)]
pub fn dashboard_merge_rgl_positions_js(
    items: JsValue,
    rgl: JsValue,
    limits: JsValue,
    cols: f64,
) -> Result<JsValue, JsError> {
    let items: Vec<LayoutItem> = serde_wasm_bindgen::from_value(items).map_err(js_error)?;
    let rgl: Vec<RglPosition> = serde_wasm_bindgen::from_value(rgl).map_err(js_error)?;
    let limits: Vec<CardLimit> = serde_wasm_bindgen::from_value(limits).map_err(js_error)?;
    js(&layout::merge_rgl_positions(&items, &rgl, &limits, cols).map_err(js_error)?)
}

/// [`lg_layout_needs_repair`](layout::lg_layout_needs_repair).
///
/// # Errors
///
/// Fails on a bad input shape or an unknown card type.
#[wasm_bindgen(js_name = dashboardLgNeedsRepair)]
pub fn dashboard_lg_needs_repair_js(items: JsValue, limits: JsValue) -> Result<bool, JsError> {
    let items: Vec<LayoutItem> = serde_wasm_bindgen::from_value(items).map_err(js_error)?;
    let limits: Vec<CardLimit> = serde_wasm_bindgen::from_value(limits).map_err(js_error)?;
    layout::lg_layout_needs_repair(&items, &limits).map_err(js_error)
}

/// [`layout_signature`](layout::layout_signature).
///
/// # Errors
///
/// Fails on a bad input shape.
#[wasm_bindgen(js_name = dashboardLayoutSignature)]
pub fn dashboard_layout_signature_js(items: JsValue) -> Result<String, JsError> {
    let items: Vec<LayoutItem> = serde_wasm_bindgen::from_value(items).map_err(js_error)?;
    Ok(layout::layout_signature(&items))
}

/// [`sm_layout_needs_repack`](layout::sm_layout_needs_repack).
///
/// # Errors
///
/// Fails on a bad input shape or an unknown card type.
#[wasm_bindgen(js_name = dashboardSmNeedsRepack)]
pub fn dashboard_sm_needs_repack_js(items: JsValue, limits: JsValue) -> Result<bool, JsError> {
    let items: Vec<LayoutItem> = serde_wasm_bindgen::from_value(items).map_err(js_error)?;
    let limits: Vec<CardLimit> = serde_wasm_bindgen::from_value(limits).map_err(js_error)?;
    layout::sm_layout_needs_repack(&items, &limits).map_err(js_error)
}
