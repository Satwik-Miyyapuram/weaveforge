//! Outbox pump routing for JavaScript (wf-core `sync::pump_route`).
//! The JS name is `pumpRoute`, called from `apps/web/src/features/offline-sync/domain/parts-3.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::sync::pump_route::{PumpInput, pump_route};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`pump_route`] for JS (TS `pumpRoute`).
///
/// # Errors
///
/// Fails when `input` is not a pump input.
#[wasm_bindgen(js_name = pumpRoute, unchecked_return_type = "B.PumpRoute")]
pub fn pump_route_js(
    #[wasm_bindgen(unchecked_param_type = "B.PumpRouteInput")] input: JsValue,
) -> JsResult<JsValue> {
    let input: PumpInput = serde_wasm_bindgen::from_value(input)?;
    to_js(&pump_route(input))
}
