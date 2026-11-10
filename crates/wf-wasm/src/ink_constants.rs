//! The ink tuning constants (wf-core `width`, `zoom`, `smooth`, `segment`,
//! `decode`, `figure`), read by `packages/core/src/ink/*.ts` through `rust()`
//! at call time. One object, so the TS side makes a single call.

use serde::Serialize;
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::ink::{decode, figure, segment, smooth, width, zoom};

use super::to_js;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct InkConstants {
    ink_width_units_per_mm: f64,
    ink_pen_widths: [f64; 4],
    ink_pen_width: f64,
    ink_highlighter_width: f64,
    ink_highlighter_widths: [f64; 4],
    ink_highlighter_min_width: f64,
    ink_min_width: f64,
    ink_max_width: f64,
    ink_velocity_full_taper: f64,
    ink_velocity_taper: f64,
    ink_pressure_min_factor: f64,
    ink_pressure_max_factor: f64,
    ink_zoom_min: f64,
    ink_zoom_max: f64,
    ink_zoom_step: f64,
    ink_smooth_spacing: f64,
    ink_smooth_passes: u32,
    ink_group_window_ms: f64,
    ink_line_band_ratio: f64,
    ink_engine_max_confidence: f64,
    figure_alt: &'static str,
    figure_handles: [&'static str; 8],
}

/// The ink tuning constants as one object.
///
/// # Errors
///
/// Fails only if the object cannot be serialised.
#[wasm_bindgen(js_name = inkConstants)]
pub fn ink_constants() -> Result<JsValue, serde_wasm_bindgen::Error> {
    to_js(&InkConstants {
        ink_width_units_per_mm: width::INK_WIDTH_UNITS_PER_MM,
        ink_pen_widths: width::INK_PEN_WIDTHS,
        ink_pen_width: width::INK_PEN_WIDTH,
        ink_highlighter_width: width::INK_HIGHLIGHTER_WIDTH,
        ink_highlighter_widths: width::INK_HIGHLIGHTER_WIDTHS,
        ink_highlighter_min_width: width::INK_HIGHLIGHTER_MIN_WIDTH,
        ink_min_width: width::INK_MIN_WIDTH,
        ink_max_width: width::INK_MAX_WIDTH,
        ink_velocity_full_taper: width::INK_VELOCITY_FULL_TAPER,
        ink_velocity_taper: width::INK_VELOCITY_TAPER,
        ink_pressure_min_factor: width::INK_PRESSURE_MIN_FACTOR,
        ink_pressure_max_factor: width::INK_PRESSURE_MAX_FACTOR,
        ink_zoom_min: zoom::INK_ZOOM_MIN,
        ink_zoom_max: zoom::INK_ZOOM_MAX,
        ink_zoom_step: zoom::INK_ZOOM_STEP,
        ink_smooth_spacing: smooth::INK_SMOOTH_SPACING,
        ink_smooth_passes: smooth::INK_SMOOTH_PASSES,
        ink_group_window_ms: segment::INK_GROUP_WINDOW_MS,
        ink_line_band_ratio: segment::INK_LINE_BAND_RATIO,
        ink_engine_max_confidence: decode::INK_ENGINE_MAX_CONFIDENCE,
        figure_alt: figure::FIGURE_ALT,
        figure_handles: figure::FIGURE_HANDLES,
    })
}
