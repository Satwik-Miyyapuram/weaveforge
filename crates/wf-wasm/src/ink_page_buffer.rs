//! The pure page-buffer helpers for JavaScript (wf-core `ink::page_buffer`). The JS
//! names match `apps/web/src/features/ink/application/parts-3.ts`, which keeps
//! the typed-array buffer and its renderer hooks.
//!
//! A box crosses the boundary as four numbers `[minX, minY, maxX, maxY]`; an empty
//! slice stands for "no box yet" where a union takes one.

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::ink::page_buffer::{self, Bounds};
use wf_core::ink::stroke_index;

fn bounds_from(values: &[f64]) -> Option<Bounds> {
    match values {
        [a, b, c, d, ..] => Some([*a, *b, *c, *d]),
        _ => None,
    }
}

/// [`bounds_of`](page_buffer::bounds_of): the box over a stroke's parallel coordinates.
#[must_use]
#[wasm_bindgen(js_name = inkBoundsOf)]
pub fn ink_bounds_of_js(xs: &[f32], ys: &[f32]) -> Vec<f64> {
    page_buffer::bounds_of(xs, ys).to_vec()
}

/// [`bounds_intersect`](page_buffer::bounds_intersect): whether two boxes touch or overlap.
#[must_use]
#[wasm_bindgen(js_name = inkBoundsIntersect)]
pub fn ink_bounds_intersect_js(a: &[f64], b: &[f64], slack: f64) -> bool {
    match (bounds_from(a), bounds_from(b)) {
        (Some(a), Some(b)) => page_buffer::bounds_intersect(a, b, slack),
        _ => false,
    }
}

/// [`bounds_union`](page_buffer::bounds_union): the covering box. An empty `a` starts from `b`.
#[must_use]
#[wasm_bindgen(js_name = inkBoundsUnion)]
pub fn ink_bounds_union_js(a: &[f64], b: &[f64]) -> Vec<f64> {
    let b = bounds_from(b).unwrap_or(page_buffer::EMPTY_BOUNDS);
    page_buffer::bounds_union(bounds_from(a), b).to_vec()
}

/// [`bounds_contain`](page_buffer::bounds_contain): whether a point lies in a box.
#[must_use]
#[wasm_bindgen(js_name = inkBoundsContain)]
pub fn ink_bounds_contain_js(bounds: &[f64], x: f64, y: f64, slack: f64) -> bool {
    let bounds = bounds_from(bounds).unwrap_or(page_buffer::EMPTY_BOUNDS);
    page_buffer::bounds_contain(bounds, x, y, slack)
}

/// [`page_bounds`](page_buffer::page_bounds): the page's box. `boxes` is four numbers per
/// stroke, and `live[i]` is 0 for a dead stroke or one with no points.
#[must_use]
#[wasm_bindgen(js_name = inkPageBounds)]
pub fn ink_page_bounds_js(boxes: &[f64], live: &[u8]) -> Vec<f64> {
    let strokes: Vec<Option<Bounds>> = live
        .iter()
        .enumerate()
        .map(|(i, flag)| {
            (*flag != 0)
                .then(|| bounds_from(&boxes[(i * 4).min(boxes.len())..]))
                .flatten()
        })
        .collect();
    page_buffer::page_bounds(&strokes).to_vec()
}

/// [`kept_indices`](page_buffer::kept_indices): the old index of each live stroke, in order.
#[must_use]
#[wasm_bindgen(js_name = inkKeptIndices)]
// Indices come from a JS byte array, which never holds more than u32::MAX items.
#[allow(clippy::cast_possible_truncation)]
pub fn ink_kept_indices_js(alive: &[u8]) -> Vec<u32> {
    let flags: Vec<bool> = alive.iter().map(|flag| *flag != 0).collect();
    page_buffer::kept_indices(&flags)
        .into_iter()
        .map(|index| index as u32)
        .collect()
}

/// [`clamp_background_index`](page_buffer::clamp_background_index): the header byte for an attachment index.
#[must_use]
#[wasm_bindgen(js_name = inkClampBackgroundIndex)]
pub fn ink_clamp_background_index_js(index: f64) -> u8 {
    page_buffer::clamp_background_index(index)
}

/// [`pick_candidates`](stroke_index::pick_candidates): the R-tree candidates that are
/// alive and meet the query box. `bounds` is four numbers per candidate, `alive` one
/// byte per candidate, and `query` is `[minX, minY, maxX, maxY]`.
#[must_use]
#[wasm_bindgen(js_name = inkPickCandidates)]
pub fn ink_pick_candidates_js(
    indices: &[u32],
    alive: &[u8],
    bounds: &[f64],
    query: &[f64],
    slack: f64,
) -> Vec<u32> {
    let flags: Vec<bool> = alive.iter().map(|flag| *flag != 0).collect();
    let query = bounds_from(query).unwrap_or(page_buffer::EMPTY_BOUNDS);
    stroke_index::pick_candidates(indices, &flags, bounds, query, slack)
}
