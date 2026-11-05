//! Text and geometry anchor resolution for JavaScript (`packages/core/src/reader/anchor-*`).
//! Each export wraps a `wf_core::reader::anchor` function; objects cross as
//! serde values and offsets are UTF-16 code units, as in the TS copy.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::reader::anchor::{
    AnchorCombinedPdf, AnchorNormaliseOptions, AnchorPdfLocus, AnchorPositionSelector,
    AnchorQuoteSelector, AnchorTextSpan, choose_anchor_strategy, find_quote_matches,
    normalise_whitespace, pick_nearest_match, resolve_position_selector, resolve_text_anchor,
};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`normalise_whitespace`] as `{ normalised, map }`; `options` is `{ trim? }` or undefined.
///
/// # Errors
///
/// Fails if `options` is not an options object, or the result cannot be converted.
#[wasm_bindgen(js_name = normaliseWhitespace)]
pub fn normalise_whitespace_js(text: &str, options: JsValue) -> JsResult<JsValue> {
    let options: AnchorNormaliseOptions = if options.is_undefined() || options.is_null() {
        AnchorNormaliseOptions::default()
    } else {
        serde_wasm_bindgen::from_value(options)?
    };
    to_js(&normalise_whitespace(text, options))
}

/// [`find_quote_matches`] as an array of `{ start, end }`.
///
/// # Errors
///
/// Fails if `quote` is not a quote selector object.
#[wasm_bindgen(js_name = findQuoteMatches)]
pub fn find_quote_matches_js(text: &str, quote: JsValue) -> JsResult<JsValue> {
    let quote: AnchorQuoteSelector = serde_wasm_bindgen::from_value(quote)?;
    to_js(&find_quote_matches(text, &quote))
}

/// [`pick_nearest_match`] as `{ start, end }`, or `null` when there is no match.
///
/// # Errors
///
/// Fails if `matches` or `position` has the wrong shape.
#[wasm_bindgen(js_name = pickNearestMatch)]
pub fn pick_nearest_match_js(matches: JsValue, position: JsValue) -> JsResult<JsValue> {
    let matches: Vec<AnchorTextSpan> = serde_wasm_bindgen::from_value(matches)?;
    let position: Option<AnchorPositionSelector> = serde_wasm_bindgen::from_value(position)?;
    to_js(&pick_nearest_match(&matches, position.as_ref()))
}

/// [`resolve_position_selector`] as `{ start, end }`, or `null` when unusable.
///
/// # Errors
///
/// Fails if `position` is not a position selector object.
#[wasm_bindgen(js_name = resolvePositionSelector)]
pub fn resolve_position_selector_js(text: &str, position: JsValue) -> JsResult<JsValue> {
    let position: AnchorPositionSelector = serde_wasm_bindgen::from_value(position)?;
    to_js(&resolve_position_selector(text, &position))
}

/// [`resolve_text_anchor`] as `{ start, end, via, confidence }`, or `null`.
///
/// # Errors
///
/// Fails if `locus` is not a locus object.
#[wasm_bindgen(js_name = resolveTextAnchor)]
pub fn resolve_text_anchor_js(text: &str, locus: JsValue) -> JsResult<JsValue> {
    let locus: AnchorPdfLocus = serde_wasm_bindgen::from_value(locus)?;
    to_js(&resolve_text_anchor(text, &locus))
}

/// [`choose_anchor_strategy`] as `{ kind, position | locus, confidence }`.
///
/// # Errors
///
/// Fails if `anchor` is not a combined anchor object, or the result cannot be converted.
#[wasm_bindgen(js_name = chooseAnchorStrategy)]
pub fn choose_anchor_strategy_js(anchor: JsValue, current_content_hash: &str) -> JsResult<JsValue> {
    let anchor: AnchorCombinedPdf = if anchor.is_undefined() || anchor.is_null() {
        AnchorCombinedPdf::default()
    } else {
        serde_wasm_bindgen::from_value(anchor)?
    };
    to_js(&choose_anchor_strategy(&anchor, current_content_hash))
}
