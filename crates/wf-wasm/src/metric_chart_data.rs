//! Metric chart data for JavaScript (wf-core `metric_chart_data`). The TS wrapper in
//! `packages/wf-wasm/src/metric-chart-data.ts` applies the types.

use serde::de::DeserializeOwned;
use wasm_bindgen::prelude::wasm_bindgen;
use wasm_bindgen::{JsError, JsValue};
use wf_core::metric_chart_data::{ChartSeries, align_series, ema_smooth, tick_format};

use super::to_js;

fn parse<T: DeserializeOwned>(value: JsValue) -> Result<T, JsError> {
    serde_wasm_bindgen::from_value(value).map_err(|error| JsError::new(&error.to_string()))
}

#[allow(clippy::needless_pass_by_value)] // `map_err` hands the error over by value.
fn js_error(error: serde_wasm_bindgen::Error) -> JsError {
    JsError::new(&error.to_string())
}

/// [`align_series`]: overlaid runs on one union step axis, gaps as `null`.
#[wasm_bindgen(js_name = alignSeries, unchecked_return_type = "B.AlignedChart")]
pub fn align_series_js(
    #[wasm_bindgen(unchecked_param_type = "B.ChartSeries[]")] series: JsValue,
) -> Result<JsValue, JsError> {
    let series: Vec<ChartSeries> = parse(series)?;
    to_js(&align_series(&series)).map_err(js_error)
}

/// [`ema_smooth`]: debiased EMA over the values; `null` gaps stay gaps.
#[wasm_bindgen(js_name = emaSmooth)]
pub fn ema_smooth_js(values: JsValue, alpha: f64) -> Result<JsValue, JsError> {
    let values: Vec<Option<f64>> = parse(values)?;
    to_js(&ema_smooth(&values, alpha)).map_err(js_error)
}

/// [`tick_format`]: how the tick labels are rendered for these values.
#[wasm_bindgen(js_name = tickFormat)]
pub fn tick_format_js(values: JsValue) -> Result<JsValue, JsError> {
    let values: Vec<f64> = parse(values)?;
    to_js(&tick_format(&values)).map_err(js_error)
}
