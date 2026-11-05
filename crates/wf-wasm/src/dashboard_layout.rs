//! Dashboard layout check for JavaScript (wf-core `dashboard::layout`). The JS name matches
//! `packages/core/src/features/dashboard/domain/parse-dashboard-layout.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::dashboard::layout;

use super::to_js;

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
