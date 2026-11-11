//! Citation text helpers for JavaScript (wf-core `reader_analysis::text`). Each export wraps
//! one function; the JS names and shapes match
//! `packages/core/src/features/reader/analysis/citation-text.ts`, `text-fingerprint.ts` and
//! `title-similarity.ts`.
//!
//! Objects cross as plain JS objects through serde; numbers cross as f64. `rectanglesOverlap`
//! takes `Float64Array`s. The TS wrappers in `packages/wf-wasm/src/wrappers-6.ts`
//! apply the defaults.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::reader_analysis::text as analysis_text;
use wf_core::reader_analysis::text::{
    AnalysisBibliographicCandidate, AnalysisBibliographicHints, AnalysisPdfItem, AnalysisSearchText,
};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`strip_invisible`](analysis_text::strip_invisible) (TS `stripInvisible`).
#[wasm_bindgen(js_name = stripInvisible)]
#[must_use]
pub fn strip_invisible_js(text: &str) -> String {
    analysis_text::strip_invisible(text)
}

/// [`compose_spacing_accents`](analysis_text::compose_spacing_accents) (TS `composeSpacingAccents`).
#[wasm_bindgen(js_name = composeSpacingAccents)]
#[must_use]
pub fn compose_spacing_accents_js(text: &str) -> String {
    analysis_text::compose_spacing_accents(text)
}

/// [`font_size_of`](analysis_text::font_size_of) (TS `fontSizeOf`).
///
/// # Errors
///
/// Fails if `item` is not a text item with `str`, `transform`, `width` and `height`.
#[wasm_bindgen(js_name = fontSizeOf)]
pub fn font_size_of_js(
    #[wasm_bindgen(unchecked_param_type = "B.AnalysisPdfItem")] item: JsValue,
) -> JsResult<f64> {
    let item: AnalysisPdfItem = serde_wasm_bindgen::from_value(item)?;
    Ok(analysis_text::font_size_of(&item))
}

/// [`search_text_from_items`](analysis_text::search_text_from_items) (TS `searchTextFromItems`).
///
/// # Errors
///
/// Fails if `items` is not an array of text items.
#[wasm_bindgen(js_name = searchTextFromItems, unchecked_return_type = "B.AnalysisSearchText")]
pub fn search_text_from_items_js(
    #[wasm_bindgen(unchecked_param_type = "readonly B.AnalysisPdfItem[]")] items: JsValue,
) -> JsResult<JsValue> {
    let items: Vec<AnalysisPdfItem> = serde_wasm_bindgen::from_value(items)?;
    to_js(&analysis_text::search_text_from_items(&items))
}

/// [`original_range`](analysis_text::original_range) as `[start, end]` (TS `originalRange`).
///
/// # Errors
///
/// Fails if `view` is not a search text with `text`, `starts` and `ends`.
#[wasm_bindgen(js_name = originalRange, unchecked_return_type = "[number, number]")]
pub fn original_range_js(
    #[wasm_bindgen(unchecked_param_type = "B.AnalysisSearchText")] view: JsValue,
    start: f64,
    end: f64,
) -> JsResult<JsValue> {
    let view: AnalysisSearchText = serde_wasm_bindgen::from_value(view)?;
    to_js(&analysis_text::original_range(&view, start, end))
}

/// [`item_to_rect`](analysis_text::item_to_rect) as `[x0, y0, x1, y1]` or null (TS `itemToRect`,
/// exported as `citationItemToRect` because `itemToRect` belongs to another lane).
///
/// # Errors
///
/// Fails if `item` is not a text item with `str`, `transform`, `width` and `height`.
#[wasm_bindgen(js_name = citationItemToRect)]
pub fn citation_item_to_rect_js(item: JsValue, from: f64, to: f64) -> JsResult<JsValue> {
    let item: AnalysisPdfItem = serde_wasm_bindgen::from_value(item)?;
    to_js(&analysis_text::item_to_rect(&item, from, to))
}

/// [`mention_rects`](analysis_text::mention_rects) as an array of rects (TS `mentionRects`).
///
/// # Errors
///
/// Fails if `items` is not an array of text items.
#[wasm_bindgen(js_name = mentionRects, unchecked_return_type = "number[][]")]
pub fn mention_rects_js(
    #[wasm_bindgen(unchecked_param_type = "readonly B.AnalysisPdfItem[]")] items: JsValue,
    start: f64,
    end: f64,
) -> JsResult<JsValue> {
    let items: Vec<AnalysisPdfItem> = serde_wasm_bindgen::from_value(items)?;
    to_js(&analysis_text::mention_rects(&items, start, end))
}

/// [`surname_key`](analysis_text::surname_key) (TS `surnameKey`).
#[wasm_bindgen(js_name = surnameKey)]
#[must_use]
pub fn surname_key_js(name: &str) -> String {
    analysis_text::surname_key(name)
}

/// [`rectangles_overlap`](analysis_text::rectangles_overlap) (TS `rectanglesOverlap`).
#[wasm_bindgen(js_name = rectanglesOverlap)]
#[must_use]
pub fn rectangles_overlap_js(
    #[wasm_bindgen(unchecked_param_type = "readonly number[]")] a: &[f64],
    #[wasm_bindgen(unchecked_param_type = "readonly number[]")] b: &[f64],
) -> bool {
    analysis_text::rectangles_overlap(a, b)
}

/// [`text_fingerprint`](analysis_text::text_fingerprint) (TS `textFingerprint`).
///
/// # Errors
///
/// Fails if `texts` is not an array of strings.
#[wasm_bindgen(js_name = textFingerprint)]
pub fn text_fingerprint_js(
    #[wasm_bindgen(unchecked_param_type = "readonly string[]")] texts: JsValue,
) -> JsResult<String> {
    let texts: Vec<String> = serde_wasm_bindgen::from_value(texts)?;
    Ok(analysis_text::text_fingerprint(&texts))
}

/// [`title_similarity`](analysis_text::title_similarity) (TS `titleSimilarity`).
#[wasm_bindgen(js_name = titleSimilarity)]
#[must_use]
pub fn title_similarity_js(left: &str, right: &str) -> f64 {
    analysis_text::title_similarity(left, right)
}

/// [`is_bibliographic_match`](analysis_text::is_bibliographic_match) (TS `isBibliographicMatch`).
///
/// # Errors
///
/// Fails if `hints` or `candidate` is not an object of the expected shape.
#[wasm_bindgen(js_name = isBibliographicMatch)]
pub fn is_bibliographic_match_js(
    #[wasm_bindgen(unchecked_param_type = "{ title?: string | null; year?: number | null }")] hints: JsValue,
    #[wasm_bindgen(unchecked_param_type = "{ title: string; year?: number | null }")]
    candidate: JsValue,
) -> JsResult<bool> {
    let hints: AnalysisBibliographicHints = serde_wasm_bindgen::from_value(hints)?;
    let candidate: AnalysisBibliographicCandidate = serde_wasm_bindgen::from_value(candidate)?;
    Ok(analysis_text::is_bibliographic_match(&hints, &candidate))
}
