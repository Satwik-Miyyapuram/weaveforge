//! Citation candidates and pattern mentions for JavaScript (wf-core `reader_analysis::citations`).
//! Each export wraps one function; the JS names and shapes match
//! `packages/core/src/features/reader/analysis/citations.ts`.
//!
//! Objects cross as plain JS objects through serde; the exports apply the defaults.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::reader_analysis::citations as analysis_citations;
use wf_core::reader_analysis::citations::CitationPage;
use wf_core::reader_analysis::text::AnalysisPdfItem;
use wf_core::reader_analysis::types::{AnalysisPageTextRange, AnalysisParsedReference};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`match_author_year_text`](analysis_citations::match_author_year_text) (TS `matchAuthorYearText`).
///
/// # Errors
///
/// Fails if `refs` is not an array of parsed references.
#[wasm_bindgen(js_name = matchAuthorYearText, unchecked_return_type = "number[]")]
pub fn match_author_year_text_js(
    text: &str,
    #[wasm_bindgen(unchecked_param_type = "readonly B.AnalysisParsedReference[]")] refs: JsValue,
) -> JsResult<JsValue> {
    let refs: Vec<AnalysisParsedReference> = serde_wasm_bindgen::from_value(refs)?;
    to_js(&analysis_citations::match_author_year_text(text, &refs))
}

/// [`in_reference_list`](analysis_citations::in_reference_list) (TS `inReferenceList`).
///
/// # Errors
///
/// Fails if `ranges` is not an array of page text ranges.
#[wasm_bindgen(js_name = inReferenceList)]
pub fn in_reference_list_js(
    page: f64,
    start: f64,
    end: f64,
    #[wasm_bindgen(unchecked_param_type = "readonly B.AnalysisPageTextRange[]")] ranges: JsValue,
) -> JsResult<bool> {
    let ranges: Vec<AnalysisPageTextRange> = serde_wasm_bindgen::from_value(ranges)?;
    Ok(analysis_citations::in_reference_list(
        page, start, end, &ranges,
    ))
}

/// [`find_citation_candidates`](analysis_citations::find_citation_candidates) (TS `findCitationCandidates`).
///
/// # Errors
///
/// Fails if `items` is not an array of text items.
#[wasm_bindgen(
    js_name = findCitationCandidates,
    unchecked_return_type = "B.CitationCandidate[]"
)]
pub fn find_citation_candidates_js(
    #[wasm_bindgen(unchecked_param_type = "readonly B.AnalysisPdfItem[]")] items: JsValue,
) -> JsResult<JsValue> {
    let items: Vec<AnalysisPdfItem> = serde_wasm_bindgen::from_value(items)?;
    to_js(&analysis_citations::find_citation_candidates(&items))
}

/// [`find_pattern_citation_mentions`](analysis_citations::find_pattern_citation_mentions) (TS
/// `findPatternCitationMentions`). `excluded` defaults to none; `candidates` defaults to
/// [`find_citation_candidates`](analysis_citations::find_citation_candidates) over `page.items`.
///
/// # Errors
///
/// Fails if `page`, `refs`, `excluded` or `candidates` do not have the expected shape.
#[wasm_bindgen(
    js_name = findPatternCitationMentions,
    unchecked_return_type = "B.AnalysisCitationMention[]"
)]
pub fn find_pattern_citation_mentions_js(
    #[wasm_bindgen(
        unchecked_param_type = "{ number: number; text: string; items: readonly B.AnalysisPdfItem[] }"
    )]
    page: JsValue,
    #[wasm_bindgen(unchecked_param_type = "readonly B.AnalysisParsedReference[]")] refs: JsValue,
    #[wasm_bindgen(unchecked_optional_param_type = "readonly B.AnalysisPageTextRange[]")] excluded: Option<
        JsValue,
    >,
    #[wasm_bindgen(unchecked_optional_param_type = "readonly B.CitationCandidate[]")]
    candidates: Option<JsValue>,
) -> JsResult<JsValue> {
    let page: CitationPage = serde_wasm_bindgen::from_value(page)?;
    let refs: Vec<AnalysisParsedReference> = serde_wasm_bindgen::from_value(refs)?;
    let excluded: Vec<AnalysisPageTextRange> = match excluded {
        Some(excluded) => serde_wasm_bindgen::from_value(excluded)?,
        None => Vec::new(),
    };
    let candidates: Option<Vec<analysis_citations::CitationCandidate>> = match candidates {
        Some(candidates) => Some(serde_wasm_bindgen::from_value(candidates)?),
        None => None,
    };
    to_js(&analysis_citations::find_pattern_citation_mentions(
        &page,
        &refs,
        &excluded,
        candidates.as_deref(),
    ))
}
