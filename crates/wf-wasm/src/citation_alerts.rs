//! Citation alert scores for JavaScript (wf-core `relations::citation_alerts`).

use wasm_bindgen::prelude::wasm_bindgen;
use wasm_bindgen::{JsCast, JsValue};
use wf_core::papers::paper_ref::PaperRef;
use wf_core::relations::citation_alert_log::{AlertItem, alert_log_body};
use wf_core::relations::citation_alerts::{self, CitationSignals};
use wf_core::relations::citation_match::{LibraryEntry, match_references};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`citation_alert_score`](citation_alerts::citation_alert_score) of each candidate, in order,
/// as a plain array.
///
/// # Errors
///
/// Fails if `candidates` has the wrong shape.
#[wasm_bindgen(js_name = citationAlertScores, unchecked_return_type = "number[]")]
pub fn citation_alert_scores_js(
    #[wasm_bindgen(unchecked_param_type = "readonly B.CitationSignals[]")] candidates: JsValue,
) -> JsResult<JsValue> {
    let candidates: Vec<CitationSignals> = serde_wasm_bindgen::from_value(candidates)?;
    let scores: Vec<f64> = candidates
        .iter()
        .map(citation_alerts::citation_alert_score)
        .collect();
    to_js(&scores)
}

/// One candidate's [`citation_alert_score`](citation_alerts::citation_alert_score): recency, the
/// influential bonus and its strongest intent.
///
/// # Errors
///
/// Fails if `candidate` has the wrong shape.
#[wasm_bindgen(js_name = citationAlertScore)]
pub fn citation_alert_score_js(
    #[wasm_bindgen(unchecked_param_type = "B.CitationSignals")] candidate: JsValue,
) -> JsResult<f64> {
    let candidate: CitationSignals = serde_wasm_bindgen::from_value(candidate)?;
    Ok(citation_alerts::citation_alert_score(&candidate))
}

/// The string field `key` of `item`, or `""` when it is missing or not a string.
fn text_field(item: &JsValue, key: &str) -> String {
    js_sys::Reflect::get(item, &JsValue::from_str(key))
        .ok()
        .and_then(|value| value.as_string())
        .unwrap_or_default()
}

/// `a.localeCompare(b, "en")` as an [`Ordering`](std::cmp::Ordering).
fn locale_order(a: &str, b: &str, locales: &js_sys::Array) -> std::cmp::Ordering {
    js_sys::JsString::from(a)
        .locale_compare(b, locales, &js_sys::Object::new())
        .cmp(&0)
}

/// A copy of `candidates`, highest score first, then by title and id (`localeCompare` with
/// `"en"`). Returns the caller's own objects and does not mutate the input.
///
/// # Errors
///
/// Fails if `candidates` has the wrong shape.
#[wasm_bindgen(
    js_name = rankCitationAlerts,
    unchecked_return_type = "(B.CitationSignals & { id: string; title: string })[]"
)]
pub fn rank_citation_alerts_js(
    #[wasm_bindgen(
        unchecked_param_type = "readonly (B.CitationSignals & { id: string; title: string })[]"
    )]
    candidates: JsValue,
) -> JsResult<js_sys::Array> {
    let signals: Vec<CitationSignals> = serde_wasm_bindgen::from_value(candidates.clone())?;
    let items: js_sys::Array = candidates.unchecked_into();
    let mut ranked: Vec<(f64, String, String, JsValue)> = items
        .iter()
        .zip(&signals)
        .map(|(item, signals)| {
            let title = text_field(&item, "title");
            let id = text_field(&item, "id");
            (
                citation_alerts::citation_alert_score(signals),
                title,
                id,
                item,
            )
        })
        .collect();
    let locales = js_sys::Array::of1(&JsValue::from_str("en"));
    ranked.sort_by(|a, b| {
        b.0.total_cmp(&a.0)
            .then_with(|| locale_order(&a.1, &b.1, &locales))
            .then_with(|| locale_order(&a.2, &b.2, &locales))
    });
    Ok(ranked.into_iter().map(|(_, _, _, item)| item).collect())
}

/// [`intent_label`](citation_alerts::intent_label) of one candidate, or `null` when it has no intents.
///
/// # Errors
///
/// Fails if `candidate` has the wrong shape.
#[wasm_bindgen(js_name = citationIntentLabel, unchecked_return_type = "string | null")]
pub fn citation_intent_label_js(
    #[wasm_bindgen(unchecked_param_type = "B.CitationSignals")] candidate: JsValue,
) -> JsResult<JsValue> {
    let candidate: CitationSignals = serde_wasm_bindgen::from_value(candidate)?;
    let value = citation_alerts::intent_label(&candidate);
    Ok(value.map_or(JsValue::NULL, JsValue::from))
}

/// [`merge_seen_ids`](citation_alerts::merge_seen_ids): prior ids, then new ones, each once.
#[wasm_bindgen(js_name = mergeSeenIds)]
#[must_use]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn merge_seen_ids_js(
    #[wasm_bindgen(unchecked_param_type = "readonly string[]")] prior: Vec<String>,
    #[wasm_bindgen(unchecked_param_type = "readonly string[]")] current: Vec<String>,
) -> Vec<String> {
    citation_alerts::merge_seen_ids(&prior, &current)
}

#[wasm_bindgen(typescript_custom_section)]
const CITATION_LOG_TS: &str = r"
/** One ranked citation candidate as the alert log shows it; counts are formatted by the caller. */
export interface CitationAlertLogItem {
  title: string;
  url?: string;
  authors?: string[];
  year?: string;
  citationCount?: number;
  citationCountText?: string;
  isInfluential?: boolean;
  intents?: string[];
}

/** A library paper's identifiers, as the citation match reads them. */
export interface CitationLibraryEntry { id: string; arxivId?: string | null; doi?: string | null }

/** A reference a paper cites, as the citation match reads it. */
export interface CitationPaperRef { kind: 'arxiv' | 'doi' | 'url' | 'zotero'; value: string }
";

/// [`alert_log_body`]: the markdown log entry for an alert on `paper_title`, `ranked` best first.
///
/// # Errors
///
/// Fails if `ranked` has the wrong shape.
#[wasm_bindgen(js_name = citationAlertLogBody)]
pub fn citation_alert_log_body_js(
    paper_title: &str,
    #[wasm_bindgen(unchecked_param_type = "readonly CitationAlertLogItem[]")] ranked: JsValue,
) -> JsResult<String> {
    let ranked: Vec<AlertItem> = serde_wasm_bindgen::from_value(ranked)?;
    Ok(alert_log_body(paper_title, &ranked))
}

/// [`match_references`]: for each paper's references (aligned to `library`), the index of the
/// library paper each one matches, or `null`.
///
/// # Errors
///
/// Fails if `library` or `references` has the wrong shape.
#[wasm_bindgen(js_name = matchCitationReferences, unchecked_return_type = "(number | null)[][]")]
pub fn match_citation_references_js(
    #[wasm_bindgen(unchecked_param_type = "readonly CitationLibraryEntry[]")] library: JsValue,
    #[wasm_bindgen(unchecked_param_type = "readonly (readonly CitationPaperRef[] | null)[]")]
    references: JsValue,
) -> JsResult<JsValue> {
    let library: Vec<LibraryEntry> = serde_wasm_bindgen::from_value(library)?;
    let references: Vec<Option<Vec<PaperRef>>> = serde_wasm_bindgen::from_value(references)?;
    to_js(&match_references(&library, &references))
}
