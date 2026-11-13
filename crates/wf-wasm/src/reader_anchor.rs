//! Text and geometry anchor resolution for JavaScript (`packages/core/src/reader/anchor-*`).
//! Each export wraps a `wf_core::reader::anchor` function; objects cross as
//! serde values and offsets are UTF-16 code units, as in the TS copy.

use js_sys::Reflect;
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
#[wasm_bindgen(
    js_name = normaliseWhitespace,
    unchecked_return_type = "{ normalised: string; map: number[] }"
)]
pub fn normalise_whitespace_js(
    text: &str,
    #[wasm_bindgen(unchecked_optional_param_type = "{ trim?: boolean }")] options: Option<JsValue>,
) -> JsResult<JsValue> {
    let options: AnchorNormaliseOptions = match options {
        Some(options) if !options.is_undefined() && !options.is_null() => {
            serde_wasm_bindgen::from_value(options)?
        }
        _ => AnchorNormaliseOptions::default(),
    };
    to_js(&normalise_whitespace(text, options))
}

/// [`find_quote_matches`] as an array of `{ start, end }`.
///
/// # Errors
///
/// Fails if `quote` is not a quote selector object.
#[wasm_bindgen(
    js_name = findQuoteMatches,
    unchecked_return_type = "{ start: number; end: number }[]"
)]
pub fn find_quote_matches_js(
    text: &str,
    #[wasm_bindgen(unchecked_param_type = "B.AnchorQuoteSelector")] quote: JsValue,
) -> JsResult<JsValue> {
    let quote: AnchorQuoteSelector = serde_wasm_bindgen::from_value(quote)?;
    to_js(&find_quote_matches(text, &quote))
}

/// [`pick_nearest_match`] as `{ start, end }`, or `undefined` when there is no match.
///
/// # Errors
///
/// Fails if `matches` or `position` has the wrong shape.
#[wasm_bindgen(
    js_name = pickNearestMatch,
    unchecked_return_type = "{ start: number; end: number } | undefined"
)]
pub fn pick_nearest_match_js(
    #[wasm_bindgen(unchecked_param_type = "readonly B.AnchorTextSpan[]")] matches: JsValue,
    #[wasm_bindgen(unchecked_param_type = "B.AnchorPositionSelector | undefined")]
    position: JsValue,
) -> JsResult<JsValue> {
    let matches: Vec<AnchorTextSpan> = serde_wasm_bindgen::from_value(matches)?;
    let position: Option<AnchorPositionSelector> = serde_wasm_bindgen::from_value(position)?;
    match pick_nearest_match(&matches, position.as_ref()) {
        Some(found) => to_js(&found),
        None => Ok(JsValue::UNDEFINED),
    }
}

/// [`resolve_position_selector`] as `{ start, end }`, or `null` when unusable.
///
/// # Errors
///
/// Fails if `position` is not a position selector object.
#[wasm_bindgen(
    js_name = resolvePositionSelector,
    unchecked_return_type = "{ start: number; end: number } | null"
)]
pub fn resolve_position_selector_js(
    text: &str,
    #[wasm_bindgen(unchecked_param_type = "B.AnchorPositionSelector")] position: JsValue,
) -> JsResult<JsValue> {
    let position: AnchorPositionSelector = serde_wasm_bindgen::from_value(position)?;
    to_js(&resolve_position_selector(text, &position))
}

/// [`resolve_text_anchor`] as `{ start, end, via, confidence }`, or `null`.
///
/// # Errors
///
/// Fails if `locus` is not a locus object.
#[wasm_bindgen(
    js_name = resolveTextAnchor,
    unchecked_return_type = "{ start: number; end: number; via: B.AnchorVia; confidence: B.AnchorConfidence } | null"
)]
pub fn resolve_text_anchor_js(
    text: &str,
    #[wasm_bindgen(unchecked_param_type = "B.AnchorPdfLocus")] locus: JsValue,
) -> JsResult<JsValue> {
    let locus: AnchorPdfLocus = serde_wasm_bindgen::from_value(locus)?;
    to_js(&resolve_text_anchor(text, &locus))
}

/// [`choose_anchor_strategy`] as `{ kind, position | locus, confidence }`. The `position` of a
/// `"rects"` strategy is the caller's own `anchor.zoteroPosition`, and the `locus` of a
/// `"quote"` strategy the caller's own `anchor.locus`, so unknown fields survive.
///
/// # Errors
///
/// Fails if `anchor` is not a combined anchor object, or the result cannot be converted.
#[wasm_bindgen(js_name = chooseAnchorStrategy, unchecked_return_type = "B.AnchorStrategy")]
pub fn choose_anchor_strategy_js(
    #[wasm_bindgen(unchecked_param_type = "T.CombinedPdfAnchor")] anchor: JsValue,
    current_content_hash: &str,
) -> Result<JsValue, JsValue> {
    let parsed: AnchorCombinedPdf = if anchor.is_undefined() || anchor.is_null() {
        AnchorCombinedPdf::default()
    } else {
        serde_wasm_bindgen::from_value(anchor.clone())?
    };
    let strategy = to_js(&choose_anchor_strategy(&parsed, current_content_hash))?;
    let kind = Reflect::get(&strategy, &JsValue::from_str("kind"))?.as_string();
    let (field, source) = match kind.as_deref() {
        Some("rects") => ("position", "zoteroPosition"),
        Some("quote") => ("locus", "locus"),
        _ => return Ok(strategy),
    };
    let own = Reflect::get(&anchor, &JsValue::from_str(source))?;
    let _ = Reflect::set(&strategy, &JsValue::from_str(field), &own)?;
    Ok(strategy)
}
