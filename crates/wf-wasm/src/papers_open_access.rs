use serde::Serialize;
use serde_json::Value;
use wasm_bindgen::prelude::wasm_bindgen;
use wasm_bindgen::{JsError, JsValue};
use wf_core::papers::open_access::{self, OpenAccessCandidate};

use super::to_js;

/// Converts a result to JS, or fails with the serializer's message.
fn out<T: Serialize>(value: &T) -> Result<JsValue, JsError> {
    to_js(value).map_err(|error| JsError::new(&error.to_string()))
}

/// Reads a JSON answer from an index, as the `serde_json` value the parsers take.
fn read(body: JsValue) -> Result<Value, JsError> {
    serde_wasm_bindgen::from_value(body).map_err(|error| JsError::new(&error.to_string()))
}

/// Reads a candidate list from JS.
fn read_candidates(list: JsValue) -> Result<Vec<OpenAccessCandidate>, JsError> {
    serde_wasm_bindgen::from_value(list).map_err(|error| JsError::new(&error.to_string()))
}

/// [`wf_core::papers::open_access::clean_arxiv_id`]: the cleaned arXiv id, or `None`.
#[allow(
    clippy::needless_pass_by_value,
    reason = "wasm_bindgen takes optional strings by value"
)]
#[must_use]
#[wasm_bindgen(js_name = cleanArxivId)]
pub fn clean_arxiv_id_js(id: Option<String>) -> Option<String> {
    open_access::clean_arxiv_id(id.as_deref())
}

/// [`wf_core::papers::open_access::clean_pmcid`]: the cleaned PMCID, or `None`.
#[allow(
    clippy::needless_pass_by_value,
    reason = "wasm_bindgen takes optional strings by value"
)]
#[must_use]
#[wasm_bindgen(js_name = cleanPmcid)]
pub fn clean_pmcid_js(id: Option<String>) -> Option<String> {
    open_access::clean_pmcid(id.as_deref())
}

/// [`wf_core::papers::open_access::resolve_arxiv_id`]: the arXiv id to ask about.
#[allow(
    clippy::needless_pass_by_value,
    reason = "wasm_bindgen takes optional strings by value"
)]
#[must_use]
#[wasm_bindgen(js_name = resolveArxivId)]
pub fn resolve_arxiv_id_js(arxiv_id: Option<String>, doi: Option<String>) -> Option<String> {
    open_access::resolve_arxiv_id(arxiv_id.as_deref(), doi.as_deref())
}

/// [`wf_core::papers::open_access::known_candidates`]: the paper's own PDF and page.
///
/// # Errors
///
/// Fails only if the result cannot be converted to a JS value.
#[allow(
    clippy::needless_pass_by_value,
    reason = "wasm_bindgen takes optional strings by value"
)]
#[wasm_bindgen(js_name = knownCandidates)]
pub fn known_candidates_js(
    known_pdf: Option<String>,
    page: Option<String>,
) -> Result<JsValue, JsError> {
    out(&open_access::known_candidates(known_pdf, page))
}

/// [`wf_core::papers::open_access::arxiv_candidates`]: arXiv's PDF and HTML copies.
///
/// # Errors
///
/// Fails only if the result cannot be converted to a JS value.
#[allow(
    clippy::needless_pass_by_value,
    reason = "wasm_bindgen takes strings by value"
)]
#[wasm_bindgen(js_name = arxivCandidates)]
pub fn arxiv_candidates_js(arxiv_id: String) -> Result<JsValue, JsError> {
    out(&open_access::arxiv_candidates(&arxiv_id))
}

/// [`wf_core::papers::open_access::pmc_candidates`]: PubMed Central's PDF and HTML copies.
///
/// # Errors
///
/// Fails only if the result cannot be converted to a JS value.
#[allow(
    clippy::needless_pass_by_value,
    reason = "wasm_bindgen takes optional strings by value"
)]
#[wasm_bindgen(js_name = pmcCandidates)]
pub fn pmc_candidates_js(pmcid: String, license: Option<String>) -> Result<JsValue, JsError> {
    out(&open_access::pmc_candidates(&pmcid, license))
}

/// [`wf_core::papers::open_access::parse_openalex`]: OpenAlex's answer as candidates.
///
/// # Errors
///
/// Fails if `body` is not valid JSON, or the result cannot be converted.
#[wasm_bindgen(js_name = parseOpenalex)]
pub fn parse_openalex_js(body: JsValue) -> Result<JsValue, JsError> {
    out(&open_access::parse_openalex(&read(body)?))
}

/// [`wf_core::papers::open_access::parse_unpaywall`]: Unpaywall's answer as candidates.
///
/// # Errors
///
/// Fails if `body` is not valid JSON, or the result cannot be converted.
#[wasm_bindgen(js_name = parseUnpaywall)]
pub fn parse_unpaywall_js(body: JsValue) -> Result<JsValue, JsError> {
    out(&open_access::parse_unpaywall(&read(body)?))
}

/// [`wf_core::papers::open_access::parse_semantic_scholar`]: Semantic Scholar's answer as candidates.
///
/// # Errors
///
/// Fails if `body` is not valid JSON, or the result cannot be converted.
#[wasm_bindgen(js_name = parseSemanticScholar)]
pub fn parse_semantic_scholar_js(body: JsValue) -> Result<JsValue, JsError> {
    out(&open_access::parse_semantic_scholar(&read(body)?))
}

/// [`wf_core::papers::open_access::parse_europe_pmc`]: Europe PMC's answer as `{ candidates, pmcid }`.
///
/// # Errors
///
/// Fails if `body` is not valid JSON, or the result cannot be converted.
#[wasm_bindgen(js_name = parseEuropePmc)]
pub fn parse_europe_pmc_js(body: JsValue) -> Result<JsValue, JsError> {
    out(&open_access::parse_europe_pmc(&read(body)?))
}

/// [`wf_core::papers::open_access::parse_biorxiv`]: a bioRxiv or medRxiv answer as candidates.
///
/// # Errors
///
/// Fails if `body` is not valid JSON, or the result cannot be converted.
#[allow(
    clippy::needless_pass_by_value,
    reason = "wasm_bindgen takes strings by value"
)]
#[wasm_bindgen(js_name = parseBiorxiv)]
pub fn parse_biorxiv_js(body: JsValue, server: String) -> Result<JsValue, JsError> {
    out(&open_access::parse_biorxiv(&read(body)?, &server))
}

/// [`wf_core::papers::open_access::parse_doaj`]: DOAJ's answer as candidates.
///
/// # Errors
///
/// Fails if `body` is not valid JSON, or the result cannot be converted.
#[wasm_bindgen(js_name = parseDoaj)]
pub fn parse_doaj_js(body: JsValue) -> Result<JsValue, JsError> {
    out(&open_access::parse_doaj(&read(body)?))
}

/// [`wf_core::papers::open_access::parse_zenodo`]: a Zenodo record's answer as candidates.
///
/// # Errors
///
/// Fails if `body` is not valid JSON, or the result cannot be converted.
#[wasm_bindgen(js_name = parseZenodo)]
pub fn parse_zenodo_js(body: JsValue) -> Result<JsValue, JsError> {
    out(&open_access::parse_zenodo(&read(body)?))
}

/// [`wf_core::papers::open_access::parse_hal`]: HAL's answer as candidates.
///
/// # Errors
///
/// Fails if `body` is not valid JSON, or the result cannot be converted.
#[wasm_bindgen(js_name = parseHal)]
pub fn parse_hal_js(body: JsValue) -> Result<JsValue, JsError> {
    out(&open_access::parse_hal(&read(body)?))
}

/// [`wf_core::papers::open_access::rank_open_access_candidates`]: deduplicated, PDFs first.
///
/// # Errors
///
/// Fails if `candidates` is not a candidate list, or the result cannot be converted.
#[wasm_bindgen(js_name = rankOpenAccessCandidates)]
pub fn rank_open_access_candidates_js(candidates: JsValue) -> Result<JsValue, JsError> {
    out(&open_access::rank_open_access_candidates(read_candidates(
        candidates,
    )?))
}
