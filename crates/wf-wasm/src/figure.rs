//! Placed figures on an ink page for JavaScript (wf-core `ink::figure`).

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::ink::figure::{
    self, FigureBox, FigureHandle, FigureOrderStep, FigurePlacement, FigureRect,
};

use super::{check_text, to_js};

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`parse_figure_tokens`](figure::parse_figure_tokens): an alt's box and crop, or `undefined`.
///
/// # Errors
///
/// Fails if `alt` is longer than the index text limit.
#[wasm_bindgen(js_name = parseFigureTokens)]
pub fn parse_figure_tokens_js(alt: &str) -> JsResult<JsValue> {
    check_text(alt)?;
    to_js(&figure::parse_figure_tokens(alt))
}

/// [`parse_figure_crop`](figure::parse_figure_crop): a `c=` value as four insets, or `undefined`.
///
/// # Errors
///
/// Fails if `raw` is longer than the index text limit.
#[wasm_bindgen(js_name = parseFigureCrop)]
pub fn parse_figure_crop_js(raw: &str) -> JsResult<JsValue> {
    check_text(raw)?;
    to_js(&figure::parse_figure_crop(raw))
}

/// [`keep_figure_on_page`](figure::keep_figure_on_page): the box's `[x, y]` kept half on the page.
///
/// # Errors
///
/// Fails if `rect` has the wrong shape.
#[wasm_bindgen(js_name = keepFigureOnPage)]
pub fn keep_figure_on_page_js(rect: JsValue, width: f64, height: f64) -> JsResult<Vec<f64>> {
    let rect: FigureRect = serde_wasm_bindgen::from_value(rect)?;
    let (x, y) = figure::keep_figure_on_page(rect, width, height);
    Ok(vec![x, y])
}

/// [`figure_corner_hit`](figure::figure_corner_hit): the corner grab distance at `scale`.
#[wasm_bindgen(js_name = figureCornerHit)]
#[must_use]
pub fn figure_corner_hit_js(scale: f64) -> f64 {
    figure::figure_corner_hit(scale)
}

/// [`format_figure_tokens`](figure::format_figure_tokens): the tokens written in an alt.
///
/// # Errors
///
/// Fails if `geometry` has the wrong shape.
#[wasm_bindgen(js_name = formatFigureTokens)]
pub fn format_figure_tokens_js(
    #[wasm_bindgen(unchecked_param_type = "B.FigureBox")] geometry: JsValue,
) -> JsResult<String> {
    let geometry: FigureBox = serde_wasm_bindgen::from_value(geometry)?;
    Ok(figure::format_figure_tokens(&geometry))
}

/// [`ink_page_figures`](figure::ink_page_figures): the figures a page's text places.
///
/// # Errors
///
/// Fails if `text` is longer than the index text limit.
#[wasm_bindgen(js_name = inkPageFigures)]
pub fn ink_page_figures_js(text: &str) -> JsResult<JsValue> {
    check_text(text)?;
    to_js(&figure::ink_page_figures(text))
}

/// [`with_ink_page_figures`](figure::with_ink_page_figures): a page's text with its figure block set.
///
/// # Errors
///
/// Fails if `text` is too long or `figures` has the wrong shape.
#[wasm_bindgen(js_name = withInkPageFigures)]
pub fn with_ink_page_figures_js(text: &str, figures: JsValue) -> JsResult<String> {
    check_text(text)?;
    let figures: Vec<FigurePlacement> = serde_wasm_bindgen::from_value(figures)?;
    Ok(figure::with_ink_page_figures(text, &figures))
}

/// [`figure_alt_for`](figure::figure_alt_for): the figure alt of the image at `path`, or `undefined`.
///
/// # Errors
///
/// Fails if `body` is longer than the index text limit.
#[wasm_bindgen(js_name = figureAltFor, unchecked_return_type = "string | null")]
pub fn figure_alt_for_js(body: &str, path: &str) -> JsResult<JsValue> {
    check_text(body)?;
    Ok(figure::figure_alt_for(body, path).map_or(JsValue::NULL, JsValue::from))
}

/// [`reorder_figure_indices`](figure::reorder_figure_indices): the new order as old indices.
///
/// # Errors
///
/// Fails if `step` is not a known step.
#[wasm_bindgen(js_name = reorderFigureIndices)]
pub fn reorder_figure_indices_js(len: u32, index: f64, step: JsValue) -> JsResult<Vec<u32>> {
    let step: FigureOrderStep = serde_wasm_bindgen::from_value(step)?;
    Ok(figure::reorder_figure_indices(len as usize, index, step)
        .into_iter()
        .map(|i| u32::try_from(i).unwrap_or(u32::MAX))
        .collect())
}

/// [`resize_figure_box`](figure::resize_figure_box): a box resized by dragging `handle`.
///
/// # Errors
///
/// Fails if `rect` or `handle` has the wrong shape.
#[wasm_bindgen(js_name = resizeFigureBox)]
pub fn resize_figure_box_js(
    rect: JsValue,
    handle: JsValue,
    dx: f64,
    dy: f64,
    free: bool,
    min_side: f64,
) -> JsResult<JsValue> {
    let rect: FigureRect = serde_wasm_bindgen::from_value(rect)?;
    let handle: FigureHandle = serde_wasm_bindgen::from_value(handle)?;
    to_js(&figure::resize_figure_box(
        rect, handle, dx, dy, free, min_side,
    ))
}

/// [`uncropped_figure_box`](figure::uncropped_figure_box): the box with the crop lifted.
///
/// # Errors
///
/// Fails if `value` has the wrong shape.
#[wasm_bindgen(js_name = uncroppedFigureBox, unchecked_return_type = "B.FigureRect")]
pub fn uncropped_figure_box_js(
    #[wasm_bindgen(unchecked_param_type = "B.FigureBox")] value: JsValue,
) -> JsResult<JsValue> {
    let one: FigureBox = serde_wasm_bindgen::from_value(value)?;
    to_js(&figure::uncropped_figure_box(&one))
}

/// [`figure_image_frame`](figure::figure_image_frame): the whole picture inside the frame, in percent.
///
/// # Errors
///
/// Fails if `value` has the wrong shape.
#[wasm_bindgen(js_name = figureImageFrame, unchecked_return_type = "B.FigureImageFrame")]
pub fn figure_image_frame_js(
    #[wasm_bindgen(unchecked_param_type = "B.FigureBox")] value: JsValue,
) -> JsResult<JsValue> {
    let one: FigureBox = serde_wasm_bindgen::from_value(value)?;
    to_js(&figure::figure_image_frame(&one))
}

/// [`crop_figure_to`](figure::crop_figure_to): a figure re-cropped to `kept` inside `full`.
///
/// # Errors
///
/// Fails if `full` or `kept` has the wrong shape.
#[wasm_bindgen(js_name = cropFigureTo)]
pub fn crop_figure_to_js(full: JsValue, kept: JsValue) -> JsResult<JsValue> {
    let full: FigureRect = serde_wasm_bindgen::from_value(full)?;
    let kept: FigureRect = serde_wasm_bindgen::from_value(kept)?;
    to_js(&figure::crop_figure_to(full, kept))
}
