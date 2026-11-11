//! Ink engine registry, line strokes and page titles for JavaScript (wf-core
//! `ink::ink_engine` and `net::page_title`). The JS names match
//! `packages/core/src/ink/parts-2.ts`, `ink/segment.ts` and `net/page-title.ts`.

use serde::Deserialize;
use serde_json::Value;
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::ink::ink_engine;
use wf_core::net::page_title;
use wf_core::net::page_title::decode_html_entities;

use super::{check_text, to_js};

/// The `{ strokeStart, strokeCount }` part of an `InkLineRecord`, the only fields
/// `inkLineStrokes` reads.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LineRange {
    stroke_start: u32,
    stroke_count: u32,
}

/// [`is_ink_engine_id`](ink_engine::is_ink_engine_id).
#[wasm_bindgen(js_name = isInkEngineId)]
pub fn is_ink_engine_id_js(id: &str) -> bool {
    ink_engine::is_ink_engine_id(id)
}

/// [`ink_engine_rank`](ink_engine::ink_engine_rank): the engine's preference rank, or the
/// engine count for an unknown id.
#[wasm_bindgen(js_name = inkEngineRank)]
#[must_use]
pub fn ink_engine_rank_js(id: &str) -> usize {
    ink_engine::ink_engine_rank(id)
}

/// [`ink_engine_info`](ink_engine::ink_engine_info): the engine's declared facts, or
/// `null` for an unknown id.
///
/// # Errors
///
/// Fails only if the value cannot be converted to a JS value.
#[wasm_bindgen(js_name = inkEngineInfo)]
pub fn ink_engine_info_js(id: &str) -> Result<JsValue, serde_wasm_bindgen::Error> {
    to_js(&ink_engine::ink_engine_info(id))
}

/// [`ink_line_strokes`](ink_engine::ink_line_strokes): the strokes of one line, given
/// the line record `{ strokeStart, strokeCount, ... }`. Strokes pass through as JS values.
///
/// # Errors
///
/// Fails if `strokes` is not an array or `line` lacks `strokeStart` / `strokeCount`.
#[wasm_bindgen(js_name = inkLineStrokes)]
pub fn ink_line_strokes_js(
    strokes: JsValue,
    line: JsValue,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let strokes: Vec<Value> = serde_wasm_bindgen::from_value(strokes)?;
    let range: LineRange = serde_wasm_bindgen::from_value(line)?;
    to_js(&ink_engine::ink_line_strokes(
        &strokes,
        range.stroke_start,
        range.stroke_count,
    ))
}

/// [`extract_page_title`](page_title::extract_page_title): `{ title, suspect }`, or
/// `null` when the HTML has no title.
///
/// # Errors
///
/// Fails if `html` exceeds `MAX_INDEX_TEXT_UTF16` UTF-16 units.
#[wasm_bindgen(js_name = extractPageTitle)]
pub fn extract_page_title_js(html: &str) -> Result<JsValue, serde_wasm_bindgen::Error> {
    check_text(html)?;
    to_js(&page_title::extract_page_title(html))
}

/// [`decode_html_entities`]: the named and numeric entities in `value`, decoded once.
///
/// # Errors
///
/// Fails if `value` exceeds `MAX_INDEX_TEXT_UTF16` UTF-16 units.
#[wasm_bindgen(js_name = decodeHtmlEntities)]
pub fn decode_html_entities_js(value: &str) -> Result<String, serde_wasm_bindgen::Error> {
    check_text(value)?;
    Ok(decode_html_entities(value))
}

/// [`PAGE_TITLE_SCAN_CHARS`](page_title::PAGE_TITLE_SCAN_CHARS): how much of a page body the
/// title scan reads, read at call time.
#[wasm_bindgen(js_name = pageTitleScanChars)]
#[must_use]
pub fn page_title_scan_chars_js() -> u32 {
    u32::try_from(page_title::PAGE_TITLE_SCAN_CHARS).unwrap_or(u32::MAX)
}
