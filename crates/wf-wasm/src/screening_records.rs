//! Screening rules for JavaScript (wf-core `reading_lists::screening`). The JS names match
//! `packages/core/src/features/reading-lists/domain/screening.ts`.
//!
//! The TS wrappers in `packages/wf-wasm/src/screening-records.ts` throw `ScreeningError`,
//! rebuild the `Map` and apply the default stage.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::reading_lists::screening::{
    self, ScreeningDecision, ScreeningDecisionDraft, ScreeningItem, ScreeningStage,
};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

fn decisions_from(value: JsValue) -> JsResult<Vec<ScreeningDecision>> {
    serde_wasm_bindgen::from_value(value)
}

/// [`decision_error`](screening::decision_error) (TS `checkDecision`). The message, or
/// `undefined` when the decision may be recorded.
///
/// # Errors
///
/// Fails if `next` or `existing` has the wrong shape.
#[wasm_bindgen(js_name = screeningDecisionError)]
pub fn screening_decision_error_js(next: JsValue, existing: JsValue) -> JsResult<Option<String>> {
    let next: ScreeningDecisionDraft = serde_wasm_bindgen::from_value(next)?;
    Ok(screening::decision_error(&next, &decisions_from(existing)?))
}

/// [`latest_by_reviewer`](screening::latest_by_reviewer) (TS `latestByReviewer`), as the
/// decisions in `Map` order.
///
/// # Errors
///
/// Fails if `decisions` or `stage` has the wrong shape.
#[wasm_bindgen(js_name = latestByReviewerList)]
pub fn latest_by_reviewer_js(
    decisions: JsValue,
    item_id: &str,
    stage: JsValue,
) -> JsResult<JsValue> {
    let decisions = decisions_from(decisions)?;
    let stage: ScreeningStage = serde_wasm_bindgen::from_value(stage)?;
    to_js(&screening::latest_by_reviewer(&decisions, item_id, stage))
}

/// [`verdict_for`](screening::verdict_for) (TS `verdictFor`).
///
/// # Errors
///
/// Fails if `decisions` or `stage` has the wrong shape.
#[wasm_bindgen(js_name = verdictFor)]
pub fn verdict_for_js(decisions: JsValue, item_id: &str, stage: JsValue) -> JsResult<JsValue> {
    let decisions = decisions_from(decisions)?;
    let stage: ScreeningStage = serde_wasm_bindgen::from_value(stage)?;
    to_js(&screening::verdict_for(&decisions, item_id, stage))
}

/// [`agreement_between`](screening::agreement_between) (TS `agreementBetween`).
///
/// # Errors
///
/// Fails if an argument has the wrong shape.
#[wasm_bindgen(js_name = agreementBetween)]
pub fn agreement_between_js(
    decisions: JsValue,
    reviewers: JsValue,
    stage: JsValue,
) -> JsResult<JsValue> {
    let decisions = decisions_from(decisions)?;
    let reviewers: (String, String) = serde_wasm_bindgen::from_value(reviewers)?;
    let stage: ScreeningStage = serde_wasm_bindgen::from_value(stage)?;
    to_js(&screening::agreement_between(&decisions, reviewers, stage))
}

/// [`prisma_counts`](screening::prisma_counts) (TS `prismaCounts`).
///
/// # Errors
///
/// Fails if `items` or `decisions` has the wrong shape.
#[wasm_bindgen(js_name = prismaCounts)]
pub fn prisma_counts_js(items: JsValue, decisions: JsValue) -> JsResult<JsValue> {
    let items: Vec<ScreeningItem> = serde_wasm_bindgen::from_value(items)?;
    to_js(&screening::prisma_counts(
        &items,
        &decisions_from(decisions)?,
    ))
}

/// [`exclusion_reasons`](screening::exclusion_reasons) (TS `exclusionReasons`).
///
/// # Errors
///
/// Fails if `decisions` or `stage` has the wrong shape.
#[wasm_bindgen(js_name = exclusionReasons)]
pub fn exclusion_reasons_js(decisions: JsValue, stage: JsValue) -> JsResult<JsValue> {
    let decisions = decisions_from(decisions)?;
    let stage: ScreeningStage = serde_wasm_bindgen::from_value(stage)?;
    to_js(&screening::exclusion_reasons(&decisions, stage))
}
