//! Metric chart sizing for JavaScript (wf-core `plot_size`).

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::{JsError, wasm_bindgen};
use wf_core::plot_size::{self, PlotTier};

use super::to_js;

/// [`plot_tier`](plot_size::plot_tier): `"full"`, `"medium"` or `"compact"`.
#[wasm_bindgen(js_name = plotTier)]
#[must_use]
pub fn plot_tier_js(width: f64) -> String {
    plot_size::plot_tier(width).as_str().to_owned()
}

/// [`axis_spec`](plot_size::axis_spec) for a tier name (`PlotTier` in `bindings.ts`).
///
/// # Errors
///
/// Fails if `tier` is not one of the three tier names.
#[wasm_bindgen(js_name = axisSpec, unchecked_return_type = "B.AxisSpec")]
pub fn axis_spec_js(tier: &str) -> Result<JsValue, JsError> {
    let tier = parse_tier(tier)?;
    to_js(&plot_size::axis_spec(tier)).map_err(|e| JsError::new(&e.to_string()))
}

/// [`plot_height`](plot_size::plot_height).
#[wasm_bindgen(js_name = plotHeight)]
#[must_use]
pub fn plot_height_js(width: f64, base: f64) -> f64 {
    plot_size::plot_height(width, base)
}

/// [`fit_cols`](plot_size::fit_cols).
#[wasm_bindgen(js_name = fitCols)]
#[must_use]
pub fn fit_cols_js(grid_width: f64, gap: f64) -> u32 {
    plot_size::fit_cols(grid_width, gap)
}

fn parse_tier(tier: &str) -> Result<PlotTier, JsError> {
    match tier {
        "full" => Ok(PlotTier::Full),
        "medium" => Ok(PlotTier::Medium),
        "compact" => Ok(PlotTier::Compact),
        other => Err(JsError::new(&format!("unknown plot tier {other:?}"))),
    }
}
