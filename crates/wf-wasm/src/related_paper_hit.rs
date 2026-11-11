//! Related-paper hit mappers for JavaScript (wf-core `papers::related_paper_hit`).
//! The JS names match `packages/wf-wasm/src/wrappers-8.ts`.

use serde_json::{Map, Value};
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::papers::related_paper_hit::{
    self, LibraryPaper, OpenAlexWork, RelatedPaperCollectInput, RelatedPaperHit, S2Paper,
};

use super::to_js;

/// [`s2_to_hit`](related_paper_hit::s2_to_hit): the hit for a Semantic Scholar paper, or nothing
/// when it has no title.
///
/// # Errors
///
/// Fails if `paper` cannot be read as a Semantic Scholar paper object.
#[wasm_bindgen(js_name = s2ToHit)]
pub fn s2_to_hit_js(paper: JsValue) -> Result<JsValue, JsValue> {
    let paper: S2Paper = serde_wasm_bindgen::from_value(paper)?;
    Ok(to_js(&related_paper_hit::s2_to_hit(&paper))?)
}

/// [`openalex_to_hit`](related_paper_hit::openalex_to_hit): the hit for an OpenAlex work, or
/// nothing when it has no title.
///
/// # Errors
///
/// Fails if `work` cannot be read as an OpenAlex work object.
#[wasm_bindgen(js_name = openAlexToHit)]
pub fn openalex_to_hit_js(work: JsValue) -> Result<JsValue, JsValue> {
    let work: OpenAlexWork = serde_wasm_bindgen::from_value(work)?;
    Ok(to_js(&related_paper_hit::openalex_to_hit(&work))?)
}

/// [`inverted_abstract`](related_paper_hit::inverted_abstract): the abstract text, or nothing.
///
/// # Errors
///
/// Fails if `index` is neither an object nor missing.
#[wasm_bindgen(js_name = invertedAbstract)]
pub fn inverted_abstract_js(index: JsValue) -> Result<JsValue, JsValue> {
    let index: Option<Map<String, Value>> = serde_wasm_bindgen::from_value(index)?;
    Ok(to_js(&related_paper_hit::inverted_abstract(
        index.as_ref(),
    ))?)
}

/// [`seed_doi`](related_paper_hit::seed_doi): the seed's DOI, or the arXiv DOI, or nothing.
///
/// # Errors
///
/// Fails only if the result cannot be converted to a JavaScript value.
#[wasm_bindgen(js_name = seedDoi)]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn seed_doi_js(doi: Option<String>, arxiv_id: Option<String>) -> Result<JsValue, JsValue> {
    Ok(to_js(&related_paper_hit::seed_doi(
        doi.as_deref(),
        arxiv_id.as_deref(),
    ))?)
}

/// [`local_keys`](related_paper_hit::local_keys): the dedupe keys of a library.
///
/// # Errors
///
/// Fails if `papers` cannot be read as a list of library papers.
#[wasm_bindgen(js_name = localKeys, unchecked_return_type = "B.RelatedPaperKeys")]
pub fn local_keys_js(
    #[wasm_bindgen(unchecked_param_type = "unknown")] papers: JsValue,
) -> Result<JsValue, JsValue> {
    let papers: Vec<LibraryPaper> = serde_wasm_bindgen::from_value(papers)?;
    Ok(to_js(&related_paper_hit::local_keys(&papers))?)
}

/// [`collect_new_hits`](related_paper_hit::collect_new_hits): adds the new candidates up to the limit.
///
/// # Errors
///
/// Fails if `input` cannot be read as a collect input.
#[wasm_bindgen(js_name = collectNewHits, unchecked_return_type = "B.RelatedPaperCollectOutput")]
pub fn collect_new_hits_js(
    #[wasm_bindgen(unchecked_param_type = "unknown")] input: JsValue,
) -> Result<JsValue, JsValue> {
    let input: RelatedPaperCollectInput = serde_wasm_bindgen::from_value(input)?;
    Ok(to_js(&related_paper_hit::collect_new_hits(input))?)
}

/// [`sort_by_citations`](related_paper_hit::sort_by_citations): most cited first, stable.
///
/// # Errors
///
/// Fails if `hits` cannot be read as a list of hits.
#[wasm_bindgen(js_name = sortByCitations, unchecked_return_type = "(B.RelatedPaperHitRow | null)[]")]
pub fn sort_by_citations_js(
    #[wasm_bindgen(unchecked_param_type = "unknown")] hits: JsValue,
) -> Result<JsValue, JsValue> {
    let hits: Vec<Option<RelatedPaperHit>> = serde_wasm_bindgen::from_value(hits)?;
    Ok(to_js(&related_paper_hit::sort_by_citations(hits))?)
}

/// [`s2_nested_fields`](related_paper_hit::s2_nested_fields): the S2 field list for a nested paper.
#[wasm_bindgen(js_name = s2NestedFields)]
#[must_use]
pub fn s2_nested_fields_js(key: &str) -> String {
    related_paper_hit::s2_nested_fields(key)
}
