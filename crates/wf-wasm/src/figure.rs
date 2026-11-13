//! Placed figures on an ink page for JavaScript (wf-core `ink::figure`).

use js_sys::{Array, Object, Reflect};
use wasm_bindgen::prelude::wasm_bindgen;
use wasm_bindgen::{JsCast, JsValue};
use wf_core::ink::figure::{
    self, FigureBox, FigureHandle, FigureOrderStep, FigurePlacement, FigureRect,
};

use super::{check_text, to_js};

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// The page size `keepFigureOnPage` keeps a box on.
#[derive(serde::Deserialize)]
struct PageSize {
    width: f64,
    height: f64,
}

/// The `resizeFigureBox` options; a missing field takes its default.
#[derive(Default, serde::Deserialize)]
struct ResizeOptions {
    #[serde(default)]
    free: Option<bool>,
    #[serde(default)]
    min: Option<f64>,
}

/// The smallest side `resizeFigureBox` leaves when `min` is not given.
const DEFAULT_MIN_SIDE: f64 = 30.0;

/// The new order of `len` figures as old indices.
fn reorder_indices(len: usize, index: f64, step: JsValue) -> JsResult<Vec<usize>> {
    let step: FigureOrderStep = serde_wasm_bindgen::from_value(step)?;
    Ok(figure::reorder_figure_indices(len, index, step))
}

/// [`parse_figure_tokens`](figure::parse_figure_tokens): an alt's box and crop, or `null` when the
/// box is not complete. A missing crop has no `crop` key.
///
/// # Errors
///
/// Fails if `alt` is longer than the index text limit.
#[wasm_bindgen(js_name = parseFigureTokens, unchecked_return_type = "B.FigureBox | null")]
pub fn parse_figure_tokens_js(alt: &str) -> JsResult<JsValue> {
    check_text(alt)?;
    to_js(&figure::parse_figure_tokens(alt))
}

/// [`parse_figure_crop`](figure::parse_figure_crop): a `c=l,t,r,b` value as crop insets clamped
/// to 0..99, or `undefined` when it is not four numbers.
///
/// # Errors
///
/// Fails if `raw` is longer than the index text limit.
#[wasm_bindgen(
    js_name = parseFigureCrop,
    unchecked_return_type = "B.FigureBox[\"crop\"] | undefined"
)]
pub fn parse_figure_crop_js(raw: &str) -> JsResult<JsValue> {
    check_text(raw)?;
    match figure::parse_figure_crop(raw) {
        Some(crop) => to_js(&crop),
        None => Ok(JsValue::UNDEFINED),
    }
}

#[wasm_bindgen(typescript_custom_section)]
const KEEP_FIGURE_ON_PAGE_TS: &str = r"
/** The box moved so at least half of it stays on the page; the same object when it already fits. */
export function keepFigureOnPage<T extends B.FigureRect>(one: T, pageSize: { width: number; height: number }): T;
";

/// [`keep_figure_on_page`](figure::keep_figure_on_page): the box moved so at least half of it
/// stays on the page. Returns `one` itself when it already fits, else a copy with the new `x`, `y`.
///
/// # Errors
///
/// Fails if `one` or `page_size` has the wrong shape.
#[wasm_bindgen(js_name = keepFigureOnPage, skip_typescript)]
#[allow(clippy::float_cmp)] // `===` on the numbers the box already had.
pub fn keep_figure_on_page_js(one: &JsValue, page_size: JsValue) -> JsResult<JsValue> {
    let rect: FigureRect = serde_wasm_bindgen::from_value(one.clone())?;
    let page: PageSize = serde_wasm_bindgen::from_value(page_size)?;
    let (x, y) = figure::keep_figure_on_page(rect, page.width, page.height);
    if x == rect.x && y == rect.y {
        return Ok(one.clone());
    }
    let moved = Object::assign(&Object::new(), one.unchecked_ref());
    let set = |key: &str, value: f64| {
        Reflect::set(&moved, &JsValue::from_str(key), &JsValue::from_f64(value))
            .map(drop)
            .map_err(|_| serde_wasm_bindgen::Error::new("cannot move the figure"))
    };
    set("x", x)?;
    set("y", y)?;
    Ok(moved.into())
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

/// [`ink_page_figures`](figure::ink_page_figures): the figures a page's text places, in line
/// order. A missing crop has no `crop` key.
///
/// # Errors
///
/// Fails if `text` is longer than the index text limit.
#[wasm_bindgen(js_name = inkPageFigures, unchecked_return_type = "B.FigurePlacement[]")]
pub fn ink_page_figures_js(text: &str) -> JsResult<JsValue> {
    check_text(text)?;
    to_js(&figure::ink_page_figures(text))
}

/// [`with_ink_page_figures`](figure::with_ink_page_figures): a page's text with its figure block
/// set, after the background line and before the text. Extra fields are ignored; a `null` crop is
/// none.
///
/// # Errors
///
/// Fails if `text` is too long or `figures` has the wrong shape.
#[wasm_bindgen(js_name = withInkPageFigures)]
pub fn with_ink_page_figures_js(
    text: &str,
    #[wasm_bindgen(unchecked_param_type = "readonly B.FigurePlacement[]")] figures: JsValue,
) -> JsResult<String> {
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

/// [`reorder_figure_indices`](figure::reorder_figure_indices): the new order of `len` figures as
/// old indices, with the one at `index` moved by `step`.
///
/// # Errors
///
/// Fails if `step` is not a known step.
#[wasm_bindgen(js_name = reorderFigureIndices, unchecked_return_type = "number[]")]
pub fn reorder_figure_indices_js(
    len: u32,
    index: f64,
    #[wasm_bindgen(unchecked_param_type = "B.FigureOrderStep")] step: JsValue,
) -> JsResult<JsValue> {
    Ok(reorder_indices(len as usize, index, step)?
        .into_iter()
        .map(|i| JsValue::from(u32::try_from(i).unwrap_or(u32::MAX)))
        .collect::<Array>()
        .into())
}

#[wasm_bindgen(typescript_custom_section)]
const REORDER_FIGURES_TS: &str = r#"
/** The figures with the one at `index` moved; "front" is the end of the array. */
export function reorderFigures<T>(figures: readonly T[], index: number, step: B.FigureOrderStep): T[];
"#;

/// The figures with the one at `index` moved by `step`; "front" is the end of the array.
///
/// # Errors
///
/// Fails if `step` is not a known step.
#[wasm_bindgen(js_name = reorderFigures, skip_typescript)]
pub fn reorder_figures_js(figures: &Array, index: f64, step: JsValue) -> JsResult<Array> {
    let order = reorder_indices(figures.length() as usize, index, step)?;
    Ok(order
        .into_iter()
        .map(|from| figures.get(u32::try_from(from).unwrap_or(u32::MAX)))
        .collect())
}

/// [`resize_figure_box`](figure::resize_figure_box): a box resized by dragging `handle`; a corner
/// keeps the aspect unless `options.free`; no side under `options.min` (30).
///
/// # Errors
///
/// Fails if `rect`, `handle` or `options` has the wrong shape.
#[wasm_bindgen(js_name = resizeFigureBox, unchecked_return_type = "B.FigureRect")]
pub fn resize_figure_box_js(
    #[wasm_bindgen(unchecked_param_type = "B.FigureRect")] rect: JsValue,
    #[wasm_bindgen(unchecked_param_type = "B.FigureHandle")] handle: JsValue,
    dx: f64,
    dy: f64,
    #[wasm_bindgen(unchecked_optional_param_type = "{ free?: boolean; min?: number }")]
    options: Option<JsValue>,
) -> JsResult<JsValue> {
    let rect: FigureRect = serde_wasm_bindgen::from_value(rect)?;
    let handle: FigureHandle = serde_wasm_bindgen::from_value(handle)?;
    let options: ResizeOptions = match options {
        Some(options) if !options.is_null() => serde_wasm_bindgen::from_value(options)?,
        _ => ResizeOptions::default(),
    };
    to_js(&figure::resize_figure_box(
        rect,
        handle,
        dx,
        dy,
        options.free.unwrap_or(false),
        options.min.unwrap_or(DEFAULT_MIN_SIDE),
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

/// [`crop_figure_to`](figure::crop_figure_to): a figure re-cropped to `kept` inside the uncropped
/// image `full`; keeping everything clears the crop (no `crop` key).
///
/// # Errors
///
/// Fails if `full` or `kept` has the wrong shape.
#[wasm_bindgen(js_name = cropFigureTo, unchecked_return_type = "B.FigureBox")]
pub fn crop_figure_to_js(
    #[wasm_bindgen(unchecked_param_type = "B.FigureRect")] full: JsValue,
    #[wasm_bindgen(unchecked_param_type = "B.FigureRect")] kept: JsValue,
) -> JsResult<JsValue> {
    let full: FigureRect = serde_wasm_bindgen::from_value(full)?;
    let kept: FigureRect = serde_wasm_bindgen::from_value(kept)?;
    to_js(&figure::crop_figure_to(full, kept))
}
