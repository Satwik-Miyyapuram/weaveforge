//! Citation underline planning for JavaScript (`apps/web/src/features/reader/application/citation-spans.ts`).
//! Wraps `wf_core::reader::citation_spans`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::reader::citation_spans::{CiteSpan, mention_item_ranges, plan_citation_segments};
use wf_core::reader::selection::SelectionPageTextItem;

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`mention_item_ranges`]: where a mention's offsets fall in each run it covers.
///
/// # Errors
///
/// Fails if `items` is not an array of page text items.
#[wasm_bindgen(js_name = mentionItemRanges, unchecked_return_type = "B.CitationItemRange[]")]
pub fn mention_item_ranges_js(
    #[wasm_bindgen(unchecked_param_type = "readonly { str: string; hasEOL?: boolean }[]")]
    items: JsValue,
    start: f64,
    end: f64,
) -> JsResult<JsValue> {
    let items: Vec<SelectionPageTextItem> = serde_wasm_bindgen::from_value(items)?;
    to_js(&mention_item_ranges(&items, start, end))
}

/// [`plan_citation_segments`]: each run split at the mention boundaries inside it.
///
/// # Errors
///
/// Fails if `items` or `mentions` do not have the expected shape.
#[wasm_bindgen(
    js_name = planCitationSegments,
    unchecked_return_type = "{ from: number; to: number; text: string; mention?: { key: string; start: number; end: number; text?: string; label?: string; kind?: \"citation\" | \"figure\" | \"url\"; url?: string } }[][]"
)]
pub fn plan_citation_segments_js(
    #[wasm_bindgen(unchecked_param_type = "readonly { str: string; hasEOL?: boolean }[]")]
    items: JsValue,
    #[wasm_bindgen(
        unchecked_param_type = "readonly { key: string; start: number; end: number; text?: string; label?: string; kind?: \"citation\" | \"figure\" | \"url\"; url?: string }[]"
    )]
    mentions: JsValue,
) -> JsResult<JsValue> {
    let items: Vec<SelectionPageTextItem> = serde_wasm_bindgen::from_value(items)?;
    let mentions: Vec<CiteSpan> = serde_wasm_bindgen::from_value(mentions)?;
    to_js(&plan_citation_segments(&items, &mentions))
}
