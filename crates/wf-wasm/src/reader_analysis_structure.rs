//! Page-structure helpers (Rust `reader_analysis` reference section, figures, running
//! heads, headings, citations). Each export wraps one function; the JS names match the
//! TS functions they replace in `packages/core/src/features/reader/analysis/`.
//!
//! Objects cross as plain JS objects through serde; numbers cross as f64. Optional
//! arrays cross as `undefined` or `null` for `None`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::reader_analysis::citation_assembly::{assemble_page_citations, coalesce_mentions};
use wf_core::reader_analysis::citation_matcher::{PageCitationInput, match_page_citations};
use wf_core::reader_analysis::citation_style::detect_citation_style;
use wf_core::reader_analysis::citations::CitationCandidate;
use wf_core::reader_analysis::figure_mentions::{FigurePage, find_figure_mentions};
use wf_core::reader_analysis::headings::{find_heading_lines, heading_outline};
use wf_core::reader_analysis::lines::AnalysisTextLine;
use wf_core::reader_analysis::outline::OutlineReaderItem;
use wf_core::reader_analysis::pdf_links::{is_citation_destination, native_citation_mentions};
use wf_core::reader_analysis::reference_section::find_reference_section;
use wf_core::reader_analysis::running_heads::furniture_lines;
use wf_core::reader_analysis::text::AnalysisPdfItem;
use wf_core::reader_analysis::types::{
    AnalysisCitationMention, AnalysisPageTextRange, AnalysisParsedReference, AnalysisPdfPage,
};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`find_reference_section`] (TS `findReferenceSection`). `furniture` is an optional
/// per-line boolean array, `undefined` or `null` for none.
///
/// # Errors
///
/// Fails if `lines` is not an array of text lines or `furniture` is not an array of booleans.
#[wasm_bindgen(js_name = findReferenceSection)]
pub fn find_reference_section_js(
    lines: JsValue,
    body_font_size: f64,
    page_count: f64,
    furniture: JsValue,
) -> JsResult<JsValue> {
    let lines: Vec<AnalysisTextLine> = serde_wasm_bindgen::from_value(lines)?;
    let furniture: Option<Vec<bool>> = serde_wasm_bindgen::from_value(furniture)?;
    let span = find_reference_section(&lines, body_font_size, page_count, furniture.as_deref());
    to_js(&span)
}

/// [`find_figure_mentions`] (TS `findFigureMentions`). `outline` is optional.
///
/// # Errors
///
/// Fails if `pages` or `outline` do not have the expected shape.
#[wasm_bindgen(js_name = findFigureMentions)]
pub fn find_figure_mentions_js(pages: JsValue, outline: JsValue) -> JsResult<JsValue> {
    let pages: Vec<FigurePage> = serde_wasm_bindgen::from_value(pages)?;
    let outline: Option<Vec<OutlineReaderItem>> = serde_wasm_bindgen::from_value(outline)?;
    to_js(&find_figure_mentions(&pages, outline.as_deref()))
}

/// [`furniture_lines`] (TS `furnitureLines`): one boolean per line, `true` for running heads
/// and folios.
///
/// # Errors
///
/// Fails if `lines` is not an array of text lines.
#[wasm_bindgen(js_name = furnitureLines, unchecked_return_type = "boolean[]")]
pub fn furniture_lines_js(
    #[wasm_bindgen(unchecked_param_type = "readonly B.AnalysisTextLine[]")] lines: JsValue,
) -> JsResult<JsValue> {
    let lines: Vec<AnalysisTextLine> = serde_wasm_bindgen::from_value(lines)?;
    to_js(&furniture_lines(&lines))
}

/// [`find_heading_lines`] (TS `findHeadingLines`). `furniture_indices` are the positions in
/// `lines` that count as furniture (never headings); the TS wrapper maps flags to indices.
///
/// # Errors
///
/// Fails if `lines` is not an array of text lines or `furnitureIndices` is not an array of
/// non-negative integers.
#[wasm_bindgen(js_name = findHeadingLines)]
pub fn find_heading_lines_js(
    lines: JsValue,
    body: f64,
    furniture_indices: JsValue,
) -> JsResult<JsValue> {
    let lines: Vec<AnalysisTextLine> = serde_wasm_bindgen::from_value(lines)?;
    let furniture_indices: Vec<usize> = serde_wasm_bindgen::from_value(furniture_indices)?;
    let furniture: Vec<&AnalysisTextLine> = furniture_indices
        .iter()
        .filter_map(|&i| lines.get(i))
        .collect();
    to_js(&find_heading_lines(&lines, body, &furniture))
}

/// [`heading_outline`] (TS `headingOutline`).
///
/// # Errors
///
/// Fails if `headings` is not an array of text lines.
#[wasm_bindgen(js_name = headingOutline, unchecked_return_type = "B.OutlineReaderItem[]")]
pub fn heading_outline_js(
    #[wasm_bindgen(unchecked_param_type = "readonly B.AnalysisTextLine[]")] headings: JsValue,
) -> JsResult<JsValue> {
    let headings: Vec<AnalysisTextLine> = serde_wasm_bindgen::from_value(headings)?;
    to_js(&heading_outline(&headings))
}

/// [`detect_citation_style`] (TS `detectCitationStyle`). `texts` is the page texts as an array of
/// strings; the result is `"numeric"`, `"author-year"`, `"both"`, or `undefined` for neither.
///
/// # Errors
///
/// Fails if `texts` is not an array of strings.
#[wasm_bindgen(js_name = detectCitationStyle, unchecked_return_type = "B.CitationStyle | null | undefined")]
pub fn detect_citation_style_js(
    #[wasm_bindgen(unchecked_param_type = "readonly string[]")] texts: JsValue,
) -> JsResult<JsValue> {
    let texts: Vec<String> = serde_wasm_bindgen::from_value(texts)?;
    to_js(&detect_citation_style(&texts))
}

/// [`is_citation_destination`] (TS `isCitationDestination`). `name` is optional.
///
/// # Errors
///
/// Fails if `name` is neither a string nor `undefined`/`null`.
#[wasm_bindgen(js_name = isCitationDestination)]
pub fn is_citation_destination_js(name: JsValue) -> JsResult<bool> {
    let name: Option<String> = serde_wasm_bindgen::from_value(name)?;
    Ok(is_citation_destination(name.as_deref()))
}

/// [`native_citation_mentions`] (TS `nativeCitationMentions`).
///
/// # Errors
///
/// Fails if any argument does not have the expected shape.
#[wasm_bindgen(js_name = nativeCitationMentions, unchecked_return_type = "B.AnalysisCitationMention[]")]
pub fn native_citation_mentions_js(
    #[wasm_bindgen(unchecked_param_type = "B.AnalysisPdfPage")] page: JsValue,
    #[wasm_bindgen(unchecked_param_type = "readonly B.AnalysisParsedReference[]")] refs: JsValue,
    #[wasm_bindgen(unchecked_param_type = "readonly B.AnalysisPageTextRange[]")] excluded: JsValue,
) -> JsResult<JsValue> {
    let page: AnalysisPdfPage = serde_wasm_bindgen::from_value(page)?;
    let refs: Vec<AnalysisParsedReference> = serde_wasm_bindgen::from_value(refs)?;
    let excluded: Vec<AnalysisPageTextRange> = serde_wasm_bindgen::from_value(excluded)?;
    to_js(&native_citation_mentions(&page, &refs, &excluded))
}

/// [`coalesce_mentions`] (TS `coalesceMentions`).
///
/// # Errors
///
/// Fails if any argument does not have the expected shape.
#[wasm_bindgen(js_name = coalesceMentions, unchecked_return_type = "B.AnalysisCitationMention[]")]
pub fn coalesce_mentions_js(
    #[wasm_bindgen(unchecked_param_type = "readonly B.AnalysisCitationMention[]")]
    mentions: JsValue,
    text: &str,
    #[wasm_bindgen(unchecked_param_type = "readonly B.AnalysisPdfItem[]")] items: JsValue,
) -> JsResult<JsValue> {
    let mentions: Vec<AnalysisCitationMention> = serde_wasm_bindgen::from_value(mentions)?;
    let items: Vec<AnalysisPdfItem> = serde_wasm_bindgen::from_value(items)?;
    to_js(&coalesce_mentions(&mentions, text, &items))
}

/// [`assemble_page_citations`] (TS `assemblePageCitations`). `candidates` is optional.
///
/// # Errors
///
/// Fails if any argument does not have the expected shape.
#[wasm_bindgen(js_name = assemblePageCitations)]
pub fn assemble_page_citations_js(
    page: JsValue,
    native: JsValue,
    patterns: JsValue,
    excluded: JsValue,
    candidates: JsValue,
) -> JsResult<JsValue> {
    let page: AnalysisPdfPage = serde_wasm_bindgen::from_value(page)?;
    let native: Vec<AnalysisCitationMention> = serde_wasm_bindgen::from_value(native)?;
    let patterns: Vec<AnalysisCitationMention> = serde_wasm_bindgen::from_value(patterns)?;
    let excluded: Vec<AnalysisPageTextRange> = serde_wasm_bindgen::from_value(excluded)?;
    let candidates: Option<Vec<CitationCandidate>> = serde_wasm_bindgen::from_value(candidates)?;
    to_js(&assemble_page_citations(
        &page,
        &native,
        &patterns,
        &excluded,
        candidates.as_deref(),
    ))
}

/// [`match_page_citations`] (TS `matchPageCitations`).
///
/// # Errors
///
/// Fails if any argument does not have the expected shape.
#[wasm_bindgen(js_name = matchPageCitations, unchecked_return_type = "B.AnalysisCitationMention[]")]
pub fn match_page_citations_js(
    #[wasm_bindgen(unchecked_param_type = "B.PageCitationInput")] page: JsValue,
    #[wasm_bindgen(unchecked_param_type = "readonly B.AnalysisParsedReference[]")]
    references: JsValue,
    #[wasm_bindgen(unchecked_param_type = "readonly B.AnalysisPageTextRange[]")]
    reference_ranges: JsValue,
) -> JsResult<JsValue> {
    let page: PageCitationInput = serde_wasm_bindgen::from_value(page)?;
    let references: Vec<AnalysisParsedReference> = serde_wasm_bindgen::from_value(references)?;
    let reference_ranges: Vec<AnalysisPageTextRange> =
        serde_wasm_bindgen::from_value(reference_ranges)?;
    to_js(&match_page_citations(&page, &references, &reference_ranges))
}
