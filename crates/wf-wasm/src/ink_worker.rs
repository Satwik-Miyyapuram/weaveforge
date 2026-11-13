//! Ink worker message routing and pen pressure for JavaScript (wf-core
//! `ink::worker_route`).

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::ink::worker_route::{self, InkWorkerRouteInput};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`ink_worker_route`](worker_route::ink_worker_route): the handler a worker message runs.
#[wasm_bindgen(
    js_name = inkWorkerRoute,
    unchecked_return_type = "{ action: string; predicted: boolean }"
)]
pub fn ink_worker_route_js(
    #[wasm_bindgen(
        unchecked_param_type = "{ type: string; state: { liveStrokeId: number | null; pageIndex: number }; strokeId?: number | null; pageIndex?: number; predicted?: boolean }"
    )]
    input: JsValue,
) -> JsResult<JsValue> {
    let input: InkWorkerRouteInput = serde_wasm_bindgen::from_value(input)?;
    to_js(&worker_route::ink_worker_route(&input))
}

/// [`pen_pressure_byte`](worker_route::pen_pressure_byte): a 0 to 1 pen pressure as a page byte.
#[wasm_bindgen(js_name = inkPenPressureByte)]
pub fn ink_pen_pressure_byte_js(pressure: f64) -> f64 {
    worker_route::pen_pressure_byte(pressure)
}
