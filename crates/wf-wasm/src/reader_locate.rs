//! Lasso, document-search and match-stepping helpers for JavaScript (packages/core/src/reader/ink-lasso.ts, document-search.ts). Each export wraps a `wf_core::reader::locate` function.
//!
//! Point and polygon arrays cross as `Float64Array`s (flat x,y pairs). Paths cross as one flat array plus each path's length.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::reader::locate::{
    DocumentPageText, find_document_matches, ink_paths_in_polygon, next_match_index,
    point_in_polygon,
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

/// [`ink_paths_in_polygon`]. `paths` is every path's flat `x, y` pairs back to back; `pathLengths`
/// gives each path's value count. A length that runs past `paths` is skipped.
#[wasm_bindgen(js_name = inkPathsInPolygon)]
#[must_use]
pub fn ink_paths_in_polygon_js(
    paths: &[f64],
    path_lengths: &[u32],
    polygon: &[f64],
    share: f64,
) -> bool {
    let mut slices: Vec<&[f64]> = Vec::with_capacity(path_lengths.len());
    let mut start = 0usize;
    for &len in path_lengths {
        let end = start.saturating_add(len as usize);
        if let Some(path) = paths.get(start..end) {
            slices.push(path);
        }
        start = end;
    }
    ink_paths_in_polygon(&slices, polygon, share)
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
