//! Reader viewport math, page projection and annotation sort keys for JavaScript
//! (wf-core `reader::viewport`). Each export wraps one function; the JS names and
//! shapes match `packages/core/src/reader`.
//!
//! Objects cross as plain JS objects through serde; numbers cross as f64. The
//! TS wrappers in `packages/wf-wasm/src/wrappers-8.ts` apply the defaults.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::reader::viewport::{
    ReaderContainerSize, ReaderPageProjection, ReaderPageSize, ReaderViewportScaleState,
    build_annotation_sort_index, clamp_page, clamp_scale, clamp_zoom_factor,
    compute_fit_page_scale, compute_fit_width_scale, initial_reader_viewport, next_rotation,
    normalise_page_rotation, pdf_point_to_screen, pdf_rect_to_screen_box, projected_page_size,
    resolve_viewport_scale, screen_point_to_pdf, visual_page_size, zoom_in, zoom_out,
};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`clamp_scale`]: a non-finite or non-positive scale gives 1, else clamps to the zoom range.
#[wasm_bindgen(js_name = clampScale)]
#[must_use]
pub fn clamp_scale_js(scale: f64) -> f64 {
    clamp_scale(scale)
}

/// [`compute_fit_width_scale`] (TS `computeFitWidthScale`).
///
/// # Errors
///
/// Fails if `page` or `container` is not an object with `width` and `height`.
#[wasm_bindgen(js_name = computeFitWidthScale)]
pub fn compute_fit_width_scale_js(
    #[wasm_bindgen(unchecked_param_type = "B.ReaderPageSize")] page: JsValue,
    #[wasm_bindgen(unchecked_param_type = "B.ReaderContainerSize")] container: JsValue,
    rotation: Option<f64>,
    gutter_px: Option<f64>,
) -> JsResult<f64> {
    Ok(compute_fit_width_scale(
        serde_wasm_bindgen::from_value::<ReaderPageSize>(page)?,
        serde_wasm_bindgen::from_value::<ReaderContainerSize>(container)?,
        rotation.unwrap_or(0.0),
        gutter_px.unwrap_or(24.0),
    ))
}

/// [`compute_fit_page_scale`] (TS `computeFitPageScale`).
///
/// # Errors
///
/// Fails if `page` or `container` is not an object with `width` and `height`.
#[wasm_bindgen(js_name = computeFitPageScale)]
pub fn compute_fit_page_scale_js(
    #[wasm_bindgen(unchecked_param_type = "B.ReaderPageSize")] page: JsValue,
    #[wasm_bindgen(unchecked_param_type = "B.ReaderContainerSize")] container: JsValue,
    rotation: Option<f64>,
    gutter_px: Option<f64>,
) -> JsResult<f64> {
    Ok(compute_fit_page_scale(
        serde_wasm_bindgen::from_value::<ReaderPageSize>(page)?,
        serde_wasm_bindgen::from_value::<ReaderContainerSize>(container)?,
        rotation.unwrap_or(0.0),
        gutter_px.unwrap_or(24.0),
    ))
}

/// [`visual_page_size`] as `{ width, height }` (TS `visualPageSize`).
///
/// # Errors
///
/// Fails if `page` is not an object with `width` and `height`.
#[wasm_bindgen(js_name = visualPageSize, unchecked_return_type = "B.ReaderPageSize")]
pub fn visual_page_size_js(
    #[wasm_bindgen(unchecked_param_type = "B.ReaderPageSize")] page: JsValue,
    rotation: f64,
) -> JsResult<JsValue> {
    let page = serde_wasm_bindgen::from_value::<ReaderPageSize>(page)?;
    to_js(&visual_page_size(page, rotation))
}

/// [`clamp_zoom_factor`] (TS `clampZoomFactor`).
#[wasm_bindgen(js_name = clampZoomFactor)]
#[must_use]
pub fn clamp_zoom_factor_js(factor: f64, base_scale: f64) -> f64 {
    clamp_zoom_factor(factor, base_scale)
}

/// [`zoom_in`] (TS `zoomIn`); `step` defaults to 1.25.
#[wasm_bindgen(js_name = zoomIn)]
#[must_use]
pub fn zoom_in_js(scale: f64, step: Option<f64>) -> f64 {
    zoom_in(scale, step.unwrap_or(1.25))
}

/// [`zoom_out`] (TS `zoomOut`); `step` defaults to 1.25.
#[wasm_bindgen(js_name = zoomOut)]
#[must_use]
pub fn zoom_out_js(scale: f64, step: Option<f64>) -> f64 {
    zoom_out(scale, step.unwrap_or(1.25))
}

/// [`next_rotation`] (TS `nextRotation`); `delta` defaults to 90.
#[wasm_bindgen(js_name = nextRotation, unchecked_return_type = "0 | 90 | 180 | 270")]
#[must_use]
pub fn next_rotation_js(current: f64, delta: Option<f64>) -> f64 {
    next_rotation(current, delta.unwrap_or(90.0))
}

/// [`clamp_page`] (TS `clampPage`).
#[wasm_bindgen(js_name = clampPage)]
#[must_use]
pub fn clamp_page_js(page: f64, num_pages: f64) -> f64 {
    clamp_page(page, num_pages)
}

/// [`resolve_viewport_scale`] (TS `resolveViewportScale`); `state` is `{ scale, fit, rotation }`.
///
/// # Errors
///
/// Fails if an argument is not an object of the expected shape.
#[wasm_bindgen(js_name = resolveViewportScale)]
pub fn resolve_viewport_scale_js(
    #[wasm_bindgen(
        unchecked_param_type = "Pick<B.ReaderViewportState, \"scale\" | \"fit\" | \"rotation\">"
    )]
    state: JsValue,
    #[wasm_bindgen(unchecked_param_type = "B.ReaderPageSize")] page: JsValue,
    #[wasm_bindgen(unchecked_param_type = "B.ReaderContainerSize")] container: JsValue,
) -> JsResult<f64> {
    Ok(resolve_viewport_scale(
        serde_wasm_bindgen::from_value::<ReaderViewportScaleState>(state)?,
        serde_wasm_bindgen::from_value::<ReaderPageSize>(page)?,
        serde_wasm_bindgen::from_value::<ReaderContainerSize>(container)?,
    ))
}

/// [`initial_reader_viewport`] as `{ scale, fit, rotation, page }` (TS `initialReaderViewport`).
///
/// # Errors
///
/// Fails only if the value cannot be converted to a JS value.
#[wasm_bindgen(js_name = initialReaderViewport, unchecked_return_type = "{ scale: number; fit: B.ReaderFitMode; rotation: 0 | 90 | 180 | 270; page: number }")]
pub fn initial_reader_viewport_js(page: Option<f64>) -> JsResult<JsValue> {
    to_js(&initial_reader_viewport(page.unwrap_or(1.0)))
}

/// [`normalise_page_rotation`] (TS `normalisePageRotation`): 0, 90, 180 or 270.
#[wasm_bindgen(js_name = normalisePageRotation)]
#[must_use]
pub fn normalise_page_rotation_js(rotation: f64) -> f64 {
    normalise_page_rotation(rotation)
}

/// [`projected_page_size`] as `{ width, height }` (TS `projectedPageSize`).
///
/// # Errors
///
/// Fails if `p` is not a page projection object.
#[wasm_bindgen(js_name = projectedPageSize, unchecked_return_type = "B.ReaderPageSize")]
pub fn projected_page_size_js(
    #[wasm_bindgen(unchecked_param_type = "B.ReaderPageProjection")] p: JsValue,
) -> JsResult<JsValue> {
    let p = serde_wasm_bindgen::from_value::<ReaderPageProjection>(p)?;
    to_js(&projected_page_size(p))
}

/// [`pdf_point_to_screen`] as `{ x, y }` (TS `pdfPointToScreen`).
///
/// # Errors
///
/// Fails if `p` is not a page projection object.
#[wasm_bindgen(js_name = pdfPointToScreen)]
pub fn pdf_point_to_screen_js(x: f64, y: f64, p: JsValue) -> JsResult<JsValue> {
    let p = serde_wasm_bindgen::from_value::<ReaderPageProjection>(p)?;
    to_js(&pdf_point_to_screen(x, y, p))
}

/// [`screen_point_to_pdf`] as `{ x, y }` (TS `screenPointToPdf`).
///
/// # Errors
///
/// Fails if `p` is not a page projection object.
#[wasm_bindgen(js_name = screenPointToPdf)]
pub fn screen_point_to_pdf_js(sx: f64, sy: f64, p: JsValue) -> JsResult<JsValue> {
    let p = serde_wasm_bindgen::from_value::<ReaderPageProjection>(p)?;
    to_js(&screen_point_to_pdf(sx, sy, p))
}

/// [`pdf_rect_to_screen_box`] as `{ left, top, width, height }` (TS `pdfRectToScreenBox`).
/// `rect` is flat `[x1, y1, x2, y2]`; a short array reads missing entries as NaN.
///
/// # Errors
///
/// Fails if `p` is not a page projection object.
#[wasm_bindgen(js_name = pdfRectToScreenBox)]
pub fn pdf_rect_to_screen_box_js(rect: &[f64], p: JsValue) -> JsResult<JsValue> {
    let p = serde_wasm_bindgen::from_value::<ReaderPageProjection>(p)?;
    let at = |i: usize| rect.get(i).copied().unwrap_or(f64::NAN);
    to_js(&pdf_rect_to_screen_box([at(0), at(1), at(2), at(3)], p))
}

/// [`build_annotation_sort_index`] (TS `buildAnnotationSortIndex`).
#[wasm_bindgen(js_name = buildAnnotationSortIndex)]
#[must_use]
pub fn build_annotation_sort_index_js(
    page_index: f64,
    char_offset: f64,
    top_pdf_units: f64,
) -> String {
    build_annotation_sort_index(page_index, char_offset, top_pdf_units)
}
