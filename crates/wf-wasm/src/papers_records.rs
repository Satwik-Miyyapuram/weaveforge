//! Paper record rules for JavaScript (wf-core `papers::paper`, `papers::paper_field` and
//! `papers::annotation_quotation_type`). The JS names match the TS files of the same name in
//! `packages/core/src/features/papers/domain`.
//!
//! The TS wrappers in `packages/wf-wasm/src/papers-records.ts` apply the `null` and `undefined` handling.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::papers::paper_field::PaperFieldRollupConfig;
use wf_core::papers::{annotation_quotation_type, paper, paper_field};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`normalize_doi`](paper::normalize_doi) (TS `normalizeDoi`). `None` becomes `undefined`.
#[allow(
    clippy::needless_pass_by_value,
    reason = "wasm_bindgen takes optional strings by value"
)]
#[wasm_bindgen(js_name = normalizeDoi)]
#[must_use]
pub fn normalize_doi_js(doi: Option<String>) -> Option<String> {
    paper::normalize_doi(doi.as_deref())
}

/// [`normalize_tags`](paper::normalize_tags) (TS `normalizeTags`).
#[allow(
    clippy::needless_pass_by_value,
    reason = "wasm_bindgen takes arrays by value"
)]
#[wasm_bindgen(js_name = normalizeTags)]
#[must_use]
pub fn normalize_tags_js(tags: Vec<String>) -> Vec<String> {
    paper::normalize_tags(&tags)
}

/// [`extract_hashtag_refs`](paper::extract_hashtag_refs) (TS `extractHashtagRefs`).
///
/// # Errors
///
/// Fails only if the result cannot be converted to a JS value.
#[allow(
    clippy::needless_pass_by_value,
    reason = "wasm_bindgen takes optional strings by value"
)]
#[wasm_bindgen(js_name = extractHashtagRefs)]
pub fn extract_hashtag_refs_js(text: Option<String>) -> JsResult<JsValue> {
    to_js(&paper::extract_hashtag_refs(text.as_deref()))
}

/// [`extract_hashtags`](paper::extract_hashtags) (TS `extractHashtags`).
#[allow(
    clippy::needless_pass_by_value,
    reason = "wasm_bindgen takes optional strings by value"
)]
#[wasm_bindgen(js_name = extractHashtags)]
#[must_use]
pub fn extract_hashtags_js(text: Option<String>) -> Vec<String> {
    paper::extract_hashtags(text.as_deref())
}

/// [`is_empty_paper_summary`](paper::is_empty_paper_summary) (TS `isEmptyPaperSummary`).
#[allow(
    clippy::needless_pass_by_value,
    reason = "wasm_bindgen takes optional strings by value"
)]
#[wasm_bindgen(js_name = isEmptyPaperSummary)]
#[must_use]
pub fn is_empty_paper_summary_js(summary: Option<String>) -> bool {
    paper::is_empty_paper_summary(summary.as_deref())
}

/// [`is_paper_field_kind`](paper_field::is_paper_field_kind) (TS `isPaperFieldKind`).
#[wasm_bindgen(js_name = isPaperFieldKind)]
#[must_use]
pub fn is_paper_field_kind_js(value: &str) -> bool {
    paper_field::is_paper_field_kind(value)
}

/// [`encode_rollup_options`](paper_field::encode_rollup_options) (TS `encodeRollupOptions`).
///
/// # Errors
///
/// Fails if `config` is not a rollup config object.
#[wasm_bindgen(js_name = encodeRollupOptions)]
pub fn encode_rollup_options_js(config: JsValue) -> JsResult<Vec<String>> {
    let config: PaperFieldRollupConfig = serde_wasm_bindgen::from_value(config)?;
    Ok(paper_field::encode_rollup_options(&config))
}

/// [`parse_rollup_options`](paper_field::parse_rollup_options) (TS `parseRollupOptions`).
///
/// # Errors
///
/// Fails only if the result cannot be converted to a JS value.
#[allow(
    clippy::needless_pass_by_value,
    reason = "wasm_bindgen takes arrays by value"
)]
#[wasm_bindgen(js_name = parseRollupOptions)]
pub fn parse_rollup_options_js(options: Vec<String>) -> JsResult<JsValue> {
    to_js(&paper_field::parse_rollup_options(&options))
}

/// [`is_quotation_type`](annotation_quotation_type::is_quotation_type) (TS `isQuotationType`).
#[wasm_bindgen(js_name = isQuotationType)]
#[must_use]
pub fn is_quotation_type_js(value: &str) -> bool {
    annotation_quotation_type::is_quotation_type(value)
}
