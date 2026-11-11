//! wasm exports for `reader_analysis::bibliography` (TS: `reader-analysis-bibliography.ts`).

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::reader_analysis::bibliography;
use wf_core::reader_analysis::lines::AnalysisTextLine;

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`labelNumber`](bibliography::label_number): entry number from the exec groups.
///
/// # Errors
///
/// Returns an error when `groups` is not an array of strings or `undefined`.
#[wasm_bindgen(js_name = labelNumber)]
pub fn label_number(groups: JsValue) -> JsResult<f64> {
    let groups: Vec<Option<String>> = serde_wasm_bindgen::from_value(groups)?;
    Ok(bibliography::label_number(&groups))
}

/// [`splitNumberedEntries`](bibliography::split_numbered_entries): entries by label.
///
/// # Errors
///
/// Returns an error when `lines` does not deserialize as text lines, or the result fails to convert.
#[wasm_bindgen(js_name = splitNumberedEntries, unchecked_return_type = "B.AnalysisTextLine[][]")]
pub fn split_numbered_entries(
    #[wasm_bindgen(unchecked_param_type = "readonly B.AnalysisTextLine[]")] lines: JsValue,
) -> JsResult<JsValue> {
    let lines: Vec<AnalysisTextLine> = serde_wasm_bindgen::from_value(lines)?;
    to_js(&bibliography::split_numbered_entries(&lines))
}

/// [`splitByMargins`](bibliography::split_by_margins): unnumbered entries by left margin.
///
/// # Errors
///
/// Returns an error when `lines` does not deserialize as text lines, or the result fails to convert.
#[wasm_bindgen(js_name = splitByMargins, unchecked_return_type = "B.AnalysisTextLine[][]")]
pub fn split_by_margins(
    #[wasm_bindgen(unchecked_param_type = "readonly B.AnalysisTextLine[]")] lines: JsValue,
) -> JsResult<JsValue> {
    let lines: Vec<AnalysisTextLine> = serde_wasm_bindgen::from_value(lines)?;
    to_js(&bibliography::split_by_margins(&lines))
}

/// [`splitByAuthorStart`](bibliography::split_by_author_start): entries by opening author name.
///
/// # Errors
///
/// Returns an error when `lines` does not deserialize as text lines, or the result fails to convert.
#[wasm_bindgen(js_name = splitByAuthorStart, unchecked_return_type = "B.AnalysisTextLine[][]")]
pub fn split_by_author_start(
    #[wasm_bindgen(unchecked_param_type = "readonly B.AnalysisTextLine[]")] lines: JsValue,
) -> JsResult<JsValue> {
    let lines: Vec<AnalysisTextLine> = serde_wasm_bindgen::from_value(lines)?;
    to_js(&bibliography::split_by_author_start(&lines))
}

/// [`splitBibliographyEntries`](bibliography::split_bibliography_entries): first format with three or more entries.
///
/// # Errors
///
/// Returns an error when `lines` does not deserialize as text lines, or the result fails to convert.
#[wasm_bindgen(js_name = splitBibliographyEntries, unchecked_return_type = "B.AnalysisTextLine[][]")]
pub fn split_bibliography_entries(
    #[wasm_bindgen(unchecked_param_type = "readonly B.AnalysisTextLine[]")] lines: JsValue,
) -> JsResult<JsValue> {
    let lines: Vec<AnalysisTextLine> = serde_wasm_bindgen::from_value(lines)?;
    to_js(&bibliography::split_bibliography_entries(&lines))
}

/// [`extractVenue`](bibliography::extract_venue): venue named after the title, if any.
#[wasm_bindgen(js_name = extractVenue)]
#[must_use]
pub fn extract_venue(after_title: &str) -> Option<String> {
    bibliography::extract_venue(after_title)
}

/// [`parseBibliographyEntry`](bibliography::parse_bibliography_entry): fields of one entry.
///
/// # Errors
///
/// Returns an error when `lines` is empty or does not deserialize as text lines, or the result fails to convert.
#[wasm_bindgen(
    js_name = parseBibliographyEntry,
    unchecked_return_type = "B.AnalysisParsedReference"
)]
pub fn parse_bibliography_entry(
    #[wasm_bindgen(unchecked_param_type = "readonly B.AnalysisTextLine[]")] lines: JsValue,
    index: f64,
    with_offsets: Option<bool>,
) -> JsResult<JsValue> {
    let lines: Vec<AnalysisTextLine> = serde_wasm_bindgen::from_value(lines)?;
    let with_offsets = with_offsets.unwrap_or(true);
    match bibliography::parse_bibliography_entry(&lines, index, with_offsets) {
        Some(entry) => to_js(&entry),
        None => Err(serde_wasm_bindgen::Error::new(
            "parseBibliographyEntry: no lines",
        )),
    }
}

/// [`parseBibliography`](bibliography::parse_bibliography): every entry, or none when fewer than three.
///
/// # Errors
///
/// Returns an error when `lines` does not deserialize as text lines, or the result fails to convert.
#[wasm_bindgen(
    js_name = parseBibliography,
    unchecked_return_type = "B.AnalysisParsedReference[]"
)]
pub fn parse_bibliography(
    #[wasm_bindgen(unchecked_param_type = "readonly B.AnalysisTextLine[]")] lines: JsValue,
    with_offsets: Option<bool>,
) -> JsResult<JsValue> {
    let lines: Vec<AnalysisTextLine> = serde_wasm_bindgen::from_value(lines)?;
    to_js(&bibliography::parse_bibliography(
        &lines,
        with_offsets.unwrap_or(true),
    ))
}
