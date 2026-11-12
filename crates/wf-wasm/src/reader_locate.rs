//! Lasso, document-search and match-stepping helpers for JavaScript (packages/core/src/reader/parts.ts, document-search.ts). Each export wraps a `wf_core::reader::locate` function.
//!
//! Point and polygon arrays cross as plain number arrays (flat x,y pairs); nested paths cross through serde.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::reader::locate::{
    DocumentPageText, LASSO_CAUGHT_SHARE, find_document_matches, ink_paths_in_polygon,
    next_match_index, point_in_polygon,
};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`point_in_polygon`]: is `(x, y)` inside the flat `x, y` polygon.
#[wasm_bindgen(js_name = pointInPolygon)]
#[must_use]
pub fn point_in_polygon_js(
    #[wasm_bindgen(unchecked_param_type = "readonly number[]")] polygon: &[f64],
    x: f64,
    y: f64,
) -> bool {
    point_in_polygon(polygon, x, y)
}

/// [`ink_paths_in_polygon`]: whether a loop has caught a stroke, at least `share` of its points
/// inside. `paths` is one flat `x, y` array per path; `share` defaults to [`LASSO_CAUGHT_SHARE`].
///
/// # Errors
///
/// Fails if `paths` is not an array of number arrays.
#[wasm_bindgen(js_name = inkPathsInPolygon)]
pub fn ink_paths_in_polygon_js(
    #[wasm_bindgen(unchecked_param_type = "readonly (readonly number[])[]")] paths: JsValue,
    #[wasm_bindgen(unchecked_param_type = "readonly number[]")] polygon: &[f64],
    share: Option<f64>,
) -> JsResult<bool> {
    let paths: Vec<Vec<f64>> = serde_wasm_bindgen::from_value(paths)?;
    let slices: Vec<&[f64]> = paths.iter().map(Vec::as_slice).collect();
    Ok(ink_paths_in_polygon(
        &slices,
        polygon,
        share.unwrap_or(LASSO_CAUGHT_SHARE),
    ))
}

/// [`find_document_matches`] as an array of `{ pageIndex, start, end }`; `pages` is `{ pageIndex, text }[]`.
///
/// # Errors
///
/// Fails if `pages` is not an array of `{ pageIndex, text }` objects.
#[wasm_bindgen(js_name = findDocumentMatches, unchecked_return_type = "{ pageIndex: number; start: number; end: number }[]")]
pub fn find_document_matches_js(
    #[wasm_bindgen(unchecked_param_type = "readonly { pageIndex: number; text: string }[]")] pages: JsValue,
    query: &str,
) -> JsResult<JsValue> {
    let pages: Vec<DocumentPageText> = serde_wasm_bindgen::from_value(pages)?;
    to_js(&find_document_matches(&pages, query))
}

/// [`next_match_index`]: wraparound step; -1 when `total` is 0.
#[wasm_bindgen(js_name = nextMatchIndex)]
#[must_use]
pub fn next_match_index_js(current: f64, total: f64, direction: f64) -> f64 {
    next_match_index(current, total, direction)
}
