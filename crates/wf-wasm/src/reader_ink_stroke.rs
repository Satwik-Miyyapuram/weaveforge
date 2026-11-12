//! Reader ink stroke geometry for JavaScript: capture filtering, simplification, widths,
//! grouping, hit-testing. Each export wraps a `wf_core::reader::ink_stroke` function; the JS
//! shapes match `packages/core/src/reader/parts.ts`.
//!
//! Flat point arrays cross as `Float64Array`s; nested paths and option objects cross through serde.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::reader::ink_stroke::{
    INK_COORD_DECIMALS, INK_DEFAULT_WIDTH, INK_GROUP_WINDOW_MS, INK_MIN_POINT_DISTANCE,
    INK_SIMPLIFY_TOLERANCE, ReaderCompactInkOptions, ReaderInkGroupCandidate, ReaderInkGroupNext,
    can_join_ink_group, clamp_ink_width, compact_ink_path, ink_note_width_to_pdf_points,
    ink_path_json_size, ink_paths_bounds, ink_paths_hit_test, ink_width_for_pressure,
    is_highlighter_ink, mean_pressure, quantize_ink_path, should_append_ink_point,
    simplify_ink_path, simplify_path_indices, translate_ink_paths,
};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`ink_note_width_to_pdf_points`].
#[wasm_bindgen(js_name = inkNoteWidthToPdfPoints)]
#[must_use]
pub fn ink_note_width_to_pdf_points_js(tenths: f64) -> f64 {
    ink_note_width_to_pdf_points(tenths)
}

/// [`is_highlighter_ink`]; `undefined` is `None`.
#[wasm_bindgen(js_name = isHighlighterInk)]
#[must_use]
pub fn is_highlighter_ink_js(width: Option<f64>) -> bool {
    is_highlighter_ink(width)
}

/// [`clamp_ink_width`].
#[wasm_bindgen(js_name = clampInkWidth)]
#[must_use]
pub fn clamp_ink_width_js(width: f64) -> f64 {
    clamp_ink_width(width)
}

/// [`ink_width_for_pressure`]; `base` defaults to `INK_DEFAULT_WIDTH`.
#[wasm_bindgen(js_name = inkWidthForPressure)]
#[must_use]
pub fn ink_width_for_pressure_js(pressure: Option<f64>, base: Option<f64>) -> f64 {
    ink_width_for_pressure(pressure, base.unwrap_or(INK_DEFAULT_WIDTH))
}

/// [`mean_pressure`]; `undefined` when no sample reports pressure.
#[wasm_bindgen(js_name = meanPressure)]
#[must_use]
pub fn mean_pressure_js(
    #[wasm_bindgen(unchecked_param_type = "readonly number[]")] samples: &[f64],
) -> Option<f64> {
    mean_pressure(samples)
}

/// [`should_append_ink_point`]; `minDistance` defaults to 0.75.
#[wasm_bindgen(js_name = shouldAppendInkPoint)]
#[must_use]
pub fn should_append_ink_point_js(
    #[wasm_bindgen(unchecked_param_type = "readonly number[]")] path: &[f64],
    x: f64,
    y: f64,
    min_distance: Option<f64>,
) -> bool {
    should_append_ink_point(path, x, y, min_distance.unwrap_or(INK_MIN_POINT_DISTANCE))
}

/// [`simplify_path_indices`]; `tolerance` defaults to 0.35. Returns a JS array of indices.
#[wasm_bindgen(js_name = simplifyPathIndices, unchecked_return_type = "number[]")]
pub fn simplify_path_indices_js(
    #[wasm_bindgen(unchecked_param_type = "readonly number[]")] path: &[f64],
    tolerance: Option<f64>,
) -> JsResult<JsValue> {
    to_js(&simplify_path_indices(
        path,
        tolerance.unwrap_or(INK_SIMPLIFY_TOLERANCE),
    ))
}

/// [`simplify_ink_path`]; `tolerance` defaults to 0.35. Returns a plain JS number array.
///
/// # Errors
///
/// Fails only if the result cannot be converted to JS.
#[wasm_bindgen(js_name = simplifyInkPath, unchecked_return_type = "number[]")]
pub fn simplify_ink_path_js(
    #[wasm_bindgen(unchecked_param_type = "readonly number[]")] path: &[f64],
    tolerance: Option<f64>,
) -> JsResult<JsValue> {
    to_js(&simplify_ink_path(
        path,
        tolerance.unwrap_or(INK_SIMPLIFY_TOLERANCE),
    ))
}

/// [`quantize_ink_path`]; `decimals` defaults to 2. Returns a plain JS number array.
///
/// # Errors
///
/// Fails only if the result cannot be converted to JS.
#[wasm_bindgen(js_name = quantizeInkPath, unchecked_return_type = "number[]")]
pub fn quantize_ink_path_js(
    #[wasm_bindgen(unchecked_param_type = "readonly number[]")] path: &[f64],
    decimals: Option<f64>,
) -> JsResult<JsValue> {
    to_js(&quantize_ink_path(
        path,
        decimals.unwrap_or(INK_COORD_DECIMALS),
    ))
}

/// [`compact_ink_path`]; `options` is `{ tolerance?, maxPoints?, decimals? }` or absent.
/// Returns a plain JS number array.
///
/// # Errors
///
/// Fails if `options` is not an options object, or the result cannot be converted to JS.
#[wasm_bindgen(js_name = compactInkPath, unchecked_return_type = "number[]")]
pub fn compact_ink_path_js(
    #[wasm_bindgen(unchecked_param_type = "readonly number[]")] path: &[f64],
    #[wasm_bindgen(
        unchecked_optional_param_type = "{ tolerance?: number; maxPoints?: number; decimals?: number }"
    )]
    options: Option<JsValue>,
) -> JsResult<JsValue> {
    let options: ReaderCompactInkOptions = match options {
        Some(options) if !options.is_undefined() && !options.is_null() => {
            serde_wasm_bindgen::from_value(options)?
        }
        _ => ReaderCompactInkOptions::default(),
    };
    to_js(&compact_ink_path(path, &options))
}

/// [`ink_path_json_size`].
#[wasm_bindgen(js_name = inkPathJsonSize)]
#[must_use]
pub fn ink_path_json_size_js(
    #[wasm_bindgen(unchecked_param_type = "readonly number[]")] path: &[f64],
) -> usize {
    ink_path_json_size(path)
}

/// [`can_join_ink_group`]; `group` may be `null`, `windowMs` defaults to 2000.
#[wasm_bindgen(js_name = canJoinInkGroup)]
pub fn can_join_ink_group_js(
    #[wasm_bindgen(
        unchecked_param_type = "{ pageIndex: number; color: string; width: number; pathCount: number; lastAt: number } | null"
    )]
    group: JsValue,
    #[wasm_bindgen(
        unchecked_param_type = "{ pageIndex: number; color: string; width: number; at: number }"
    )]
    next: JsValue,
    window_ms: Option<f64>,
) -> JsResult<bool> {
    let group: Option<ReaderInkGroupCandidate> = serde_wasm_bindgen::from_value(group)?;
    let next: ReaderInkGroupNext = serde_wasm_bindgen::from_value(next)?;
    Ok(can_join_ink_group(
        group.as_ref(),
        &next,
        window_ms.unwrap_or(INK_GROUP_WINDOW_MS),
    ))
}

/// [`ink_paths_hit_test`]; `paths` is an array of number arrays.
#[wasm_bindgen(js_name = inkPathsHitTest)]
pub fn ink_paths_hit_test_js(
    #[wasm_bindgen(unchecked_param_type = "readonly (readonly number[])[]")] paths: JsValue,
    x: f64,
    y: f64,
    radius: f64,
) -> JsResult<bool> {
    let paths: Vec<Vec<f64>> = serde_wasm_bindgen::from_value(paths)?;
    Ok(ink_paths_hit_test(&paths, x, y, radius))
}

/// [`translate_ink_paths`]; `decimals` defaults to 2. Returns an array of number arrays.
#[wasm_bindgen(js_name = translateInkPaths, unchecked_return_type = "number[][]")]
pub fn translate_ink_paths_js(
    #[wasm_bindgen(unchecked_param_type = "readonly (readonly number[])[]")] paths: JsValue,
    dx: f64,
    dy: f64,
    decimals: Option<f64>,
) -> JsResult<JsValue> {
    let paths: Vec<Vec<f64>> = serde_wasm_bindgen::from_value(paths)?;
    to_js(&translate_ink_paths(
        &paths,
        dx,
        dy,
        decimals.unwrap_or(INK_COORD_DECIMALS),
    ))
}

/// [`ink_paths_bounds`]; `[x1, y1, x2, y2]` or `null`.
#[wasm_bindgen(
    js_name = inkPathsBounds,
    unchecked_return_type = "[number, number, number, number] | null"
)]
pub fn ink_paths_bounds_js(
    #[wasm_bindgen(unchecked_param_type = "readonly (readonly number[])[]")] paths: JsValue,
) -> JsResult<JsValue> {
    let paths: Vec<Vec<f64>> = serde_wasm_bindgen::from_value(paths)?;
    to_js(&ink_paths_bounds(&paths))
}
