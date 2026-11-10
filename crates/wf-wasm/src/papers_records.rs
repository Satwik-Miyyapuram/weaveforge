//! Paper record rules for JavaScript (wf-core `papers::paper`, `papers::paper_field` and
//! `papers::annotation_quotation_type`). The JS names match the TS files of the same name in
//! `packages/core/src/features/papers/domain`.
//!
//! The TS wrappers in `packages/wf-wasm/src/papers-records.ts` apply the `null` and `undefined` handling.

use serde_json::{Map, Value};
use wasm_bindgen::prelude::wasm_bindgen;
use wasm_bindgen::{JsError, JsValue};
use wf_core::papers::compute_rollup::{RollupFieldDef, RollupValue, compute_rollup_for_papers};
use wf_core::papers::paper_field::{
    PaperFieldKind, PaperFieldRollupConfig, PaperFieldValueInput, coerce_paper_field_value,
    paper_field_value_refusal, parse_paper_field_value,
};
use wf_core::papers::{
    annotation_quotation_type, paper, paper_field, paper_image, related_paper_url,
};

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

/// [`resolve_related_paper_url`](related_paper_url::resolve_related_paper_url) (TS
/// `resolveRelatedPaperUrl`). `None` becomes `undefined`.
#[allow(
    clippy::needless_pass_by_value,
    reason = "wasm_bindgen takes optional strings by value"
)]
#[wasm_bindgen(js_name = resolveRelatedPaperUrl)]
#[must_use]
pub fn resolve_related_paper_url_js(
    url: Option<String>,
    doi: Option<String>,
    arxiv_id: Option<String>,
) -> Option<String> {
    related_paper_url::resolve_related_paper_url(
        url.as_deref(),
        doi.as_deref(),
        arxiv_id.as_deref(),
    )
}

/// [`images_of`](paper_image::images_of) (TS `imagesOf`). `null` metadata has no images.
///
/// # Errors
///
/// Fails if `metadata` is not an object of JSON values.
#[wasm_bindgen(js_name = imagesOf)]
pub fn images_of_js(metadata: JsValue) -> Result<Vec<String>, JsError> {
    let metadata: Option<Map<String, Value>> = serde_wasm_bindgen::from_value(metadata)
        .map_err(|error| JsError::new(&error.to_string()))?;
    Ok(metadata.map_or_else(Vec::new, |map| paper_image::images_of(&map)))
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

/// [`normalize_field_name`](paper_field::normalize_field_name) (TS `normalizeFieldName`).
#[must_use]
#[wasm_bindgen(js_name = normalizeFieldName)]
pub fn normalize_field_name_js(raw: &str) -> String {
    paper_field::normalize_field_name(raw)
}

/// [`normalize_select_options`](paper_field::normalize_select_options) (TS `normalizeSelectOptions`).
#[allow(
    clippy::needless_pass_by_value,
    reason = "wasm_bindgen takes arrays by value"
)]
#[must_use]
#[wasm_bindgen(js_name = normalizeSelectOptions)]
pub fn normalize_select_options_js(raw: Vec<String>) -> Vec<String> {
    paper_field::normalize_select_options(&raw)
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

/// [`parse_paper_field_value`] (TS `parsePaperFieldValue`). A refusal throws an `Error`
/// with the caller's `name` in the message.
#[wasm_bindgen(js_name = parsePaperFieldValue)]
pub fn parse_paper_field_value_js(value: JsValue, name: &str) -> Result<JsValue, JsError> {
    let input = serde_wasm_bindgen::from_value::<PaperFieldValueInput>(value)
        .map_err(|_| JsError::new(&paper_field_value_refusal(name)))?;
    let parsed = parse_paper_field_value(input, name).map_err(|message| JsError::new(&message))?;
    to_js(&parsed).map_err(|error| JsError::new(&error.to_string()))
}

/// [`coerce_paper_field_value`] (TS `coercePaperFieldValue`). `null` or blank clears the value
/// (returns `null`); a refusal throws an `Error` with the wf-core message.
///
/// # Errors
///
/// Fails if `kind` is not a field kind, if `value` is not a string, number, or string list,
/// or if the value is refused for `kind`.
#[wasm_bindgen(js_name = coercePaperFieldValue)]
pub fn coerce_paper_field_value_js(kind: JsValue, value: JsValue) -> Result<JsValue, JsError> {
    let kind: PaperFieldKind =
        serde_wasm_bindgen::from_value(kind).map_err(|error| JsError::new(&error.to_string()))?;
    let raw: Option<PaperFieldValueInput> = serde_wasm_bindgen::from_value(value)
        .map_err(|_| JsError::new(&paper_field_value_refusal("value")))?;
    let checked = coerce_paper_field_value(kind, raw).map_err(|message| JsError::new(&message))?;
    to_js(&checked).map_err(|error| JsError::new(&error.to_string()))
}

/// [`compute_rollup_for_papers`] (TS `computeRollupsForPapers`). One call fills a rollup column
/// for every listed paper; `null` where the rollup has no value.
#[wasm_bindgen(js_name = computeRollupsForPapers)]
pub fn compute_rollups_for_papers_js(
    paper_ids: JsValue,
    rollup: JsValue,
    defs: JsValue,
    values: JsValue,
) -> Result<JsValue, JsError> {
    let paper_ids: Vec<String> = serde_wasm_bindgen::from_value(paper_ids)
        .map_err(|error| JsError::new(&error.to_string()))?;
    let rollup: RollupFieldDef =
        serde_wasm_bindgen::from_value(rollup).map_err(|error| JsError::new(&error.to_string()))?;
    let defs: Vec<RollupFieldDef> =
        serde_wasm_bindgen::from_value(defs).map_err(|error| JsError::new(&error.to_string()))?;
    let values: Vec<RollupValue> =
        serde_wasm_bindgen::from_value(values).map_err(|error| JsError::new(&error.to_string()))?;
    let computed = compute_rollup_for_papers(&paper_ids, &rollup, &defs, &values);
    to_js(&computed).map_err(|error| JsError::new(&error.to_string()))
}
