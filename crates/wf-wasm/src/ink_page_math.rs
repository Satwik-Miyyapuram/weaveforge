//! Ink page helpers (fit, selected text, figure hit tests) for JavaScript
//! (wf-core `ink::page_math`).

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::ink::clip_to_area::Point;
use wf_core::ink::page_math::{self, HitBox, TextLine};

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// Converts an optional JS index to `usize`; an absent index skips nothing.
fn skip_index(skip: Option<u32>) -> Option<usize> {
    skip.and_then(|value| usize::try_from(value).ok())
}

/// [`fit_scale`](page_math::fit_scale): CSS pixels per 0.1 mm unit, `1` with no width.
#[wasm_bindgen(js_name = fitScale)]
pub fn fit_scale_js(container_width: f64, page_width: f64) -> f64 {
    page_math::fit_scale(container_width, page_width)
}

/// [`figure_under`](page_math::figure_under): the topmost figure holding `at`, ignoring `skip`.
///
/// # Errors
///
/// Fails if `figures` is not an array of boxes or `at` is not a point.
#[wasm_bindgen(js_name = figureUnder)]
pub fn figure_under_js(
    figures: JsValue,
    at: JsValue,
    skip: Option<u32>,
) -> JsResult<Option<usize>> {
    let figures: Vec<Option<HitBox>> = serde_wasm_bindgen::from_value(figures)?;
    let at: Point = serde_wasm_bindgen::from_value(at)?;
    Ok(page_math::figure_under(&figures, at, skip_index(skip)))
}

/// [`double_click_figure`](page_math::double_click_figure): the figure every press lands in.
///
/// # Errors
///
/// Fails if `figures` is not an array of boxes or `points` is not an array of points.
#[wasm_bindgen(js_name = doubleClickFigure)]
pub fn double_click_figure_js(
    figures: JsValue,
    points: JsValue,
    skip: Option<u32>,
) -> JsResult<Option<usize>> {
    let figures: Vec<Option<HitBox>> = serde_wasm_bindgen::from_value(figures)?;
    let points: Vec<Point> = serde_wasm_bindgen::from_value(points)?;
    Ok(page_math::double_click_figure(
        &figures,
        &points,
        skip_index(skip),
    ))
}

/// [`selected_text`](page_math::selected_text): the text of the lines the chosen strokes
/// belong to, one per line.
///
/// # Errors
///
/// Fails if `lines` is not an array of lines or `indices` is not an array of numbers.
#[wasm_bindgen(js_name = selectedText)]
pub fn selected_text_js(lines: JsValue, indices: JsValue) -> JsResult<String> {
    let lines: Vec<TextLine> = serde_wasm_bindgen::from_value(lines)?;
    let indices: Vec<usize> = serde_wasm_bindgen::from_value(indices)?;
    Ok(page_math::selected_text(&lines, &indices))
}
