//! Screening rules for JavaScript (wf-core `reading_lists::screening`). The JS names match
//! `packages/core/src/features/reading-lists/domain/parts.ts`.
//!
//! Decision and item lists are read as one `JSON.stringify` copy, not a boundary call per
//! field; a JSON string is accepted too.

use js_sys::{Function, JSON, Map, Reflect};
use wasm_bindgen::prelude::wasm_bindgen;
use wasm_bindgen::{JsCast, JsValue};
use wf_core::reading_lists::screening::{
    self, ScreeningDecision, ScreeningDecisionDraft, ScreeningItem, ScreeningStage,
};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// A list given as objects or as one JSON string. A screen of thousands crosses as a
/// string in one copy; as objects it costs a boundary call per field.
pub(crate) fn list_from<T: serde::de::DeserializeOwned>(value: JsValue) -> JsResult<Vec<T>> {
    match value.as_string() {
        Some(json) => serde_json::from_str(&json).map_err(serde_wasm_bindgen::Error::new),
        None => serde_wasm_bindgen::from_value(value),
    }
}

/// A list given as objects (read as one `JSON.stringify` copy) or as one JSON string.
fn list_via_json<T: serde::de::DeserializeOwned>(value: &JsValue) -> JsResult<Vec<T>> {
    let json = match value.as_string() {
        Some(json) => json,
        None => JSON::stringify(value)
            .ok()
            .and_then(|json| json.as_string())
            .ok_or_else(|| serde_wasm_bindgen::Error::new("expected a list"))?,
    };
    serde_json::from_str(&json).map_err(serde_wasm_bindgen::Error::new)
}

#[allow(clippy::needless_pass_by_value)] // Callers hand over owned wasm-bindgen arguments.
fn decisions_from(value: JsValue) -> JsResult<Vec<ScreeningDecision>> {
    list_via_json(&value)
}

/// JS `String(value)`.
fn js_string(value: &JsValue) -> Result<String, JsValue> {
    let string: Function =
        Reflect::get(&js_sys::global(), &JsValue::from_str("String"))?.dyn_into()?;
    Ok(string
        .call1(&JsValue::UNDEFINED, value)?
        .as_string()
        .unwrap_or_default())
}

/// [`decision_error`](screening::decision_error) (TS `checkDecision`): throws an `Error` named
/// `ScreeningError` when `next` may not be recorded after `existing`. `stage` and `state` are
/// read as `String(...)`.
///
/// # Errors
///
/// Throws `ScreeningError`, or fails if `next` or `existing` has the wrong shape.
#[wasm_bindgen(js_name = checkDecision)]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn check_decision_js(
    #[wasm_bindgen(
        unchecked_param_type = "Pick<B.ScreeningDecision, \"itemId\" | \"reviewerId\" | \"stage\" | \"state\">"
    )]
    next: JsValue,
    #[wasm_bindgen(unchecked_param_type = "readonly B.ScreeningDecision[]")] existing: JsValue,
) -> Result<(), JsValue> {
    let draft = ScreeningDecisionDraft {
        item_id: serde_wasm_bindgen::from_value(Reflect::get(
            &next,
            &JsValue::from_str("itemId"),
        )?)?,
        reviewer_id: serde_wasm_bindgen::from_value(Reflect::get(
            &next,
            &JsValue::from_str("reviewerId"),
        )?)?,
        stage: js_string(&Reflect::get(&next, &JsValue::from_str("stage"))?)?,
        state: js_string(&Reflect::get(&next, &JsValue::from_str("state"))?)?,
    };
    match screening::decision_error(&draft, &decisions_from(existing)?) {
        Some(message) => {
            let error = js_sys::Error::new(&message);
            error.set_name("ScreeningError");
            Err(error.into())
        }
        None => Ok(()),
    }
}

/// [`decision_error`](screening::decision_error) (TS `screeningDecisionError`): why `next` may
/// not be recorded after `existing`, or `null` when it may.
///
/// # Errors
///
/// Fails if `next` or `existing` has the wrong shape.
#[wasm_bindgen(js_name = screeningDecisionError, unchecked_return_type = "string | null")]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn screening_decision_error_js(
    #[wasm_bindgen(unchecked_param_type = "B.ScreeningDecisionDraft")] next: JsValue,
    #[wasm_bindgen(unchecked_param_type = "readonly B.ScreeningDecision[]")] existing: JsValue,
) -> JsResult<JsValue> {
    let next: ScreeningDecisionDraft = serde_wasm_bindgen::from_value(next)?;
    let message = screening::decision_error(&next, &decisions_from(existing)?);
    Ok(message.map_or(JsValue::NULL, JsValue::from))
}

/// [`latest_by_reviewer`](screening::latest_by_reviewer) (TS `latestByReviewerList`): the
/// latest decision of each reviewer for one item, as a list in `Map` order.
///
/// # Errors
///
/// Fails if `decisions` or `stage` has the wrong shape.
#[wasm_bindgen(js_name = latestByReviewerList, unchecked_return_type = "B.ScreeningDecision[]")]
pub fn latest_by_reviewer_js(
    #[wasm_bindgen(unchecked_param_type = "readonly B.ScreeningDecision[]")] decisions: JsValue,
    item_id: &str,
    #[wasm_bindgen(unchecked_param_type = "B.ScreeningStage")] stage: JsValue,
) -> JsResult<JsValue> {
    let decisions = decisions_from(decisions)?;
    let stage: ScreeningStage = serde_wasm_bindgen::from_value(stage)?;
    to_js(&screening::latest_by_reviewer(&decisions, item_id, stage))
}

/// [`latest_by_reviewer`](screening::latest_by_reviewer) (TS `latestByReviewer`): the latest
/// decision each reviewer recorded for one item, keyed by reviewer id.
///
/// # Errors
///
/// Fails if `decisions` or `stage` has the wrong shape.
#[wasm_bindgen(
    js_name = latestByReviewer,
    unchecked_return_type = "Map<string, B.ScreeningDecision>"
)]
pub fn latest_by_reviewer_map_js(
    #[wasm_bindgen(unchecked_param_type = "readonly B.ScreeningDecision[]")] decisions: JsValue,
    item_id: &str,
    #[wasm_bindgen(unchecked_param_type = "B.ScreeningStage")] stage: JsValue,
) -> JsResult<JsValue> {
    let decisions = decisions_from(decisions)?;
    let stage: ScreeningStage = serde_wasm_bindgen::from_value(stage)?;
    let map = Map::new();
    for decision in screening::latest_by_reviewer(&decisions, item_id, stage) {
        let _ = map.set(&JsValue::from_str(&decision.reviewer_id), &to_js(decision)?);
    }
    Ok(map.into())
}

/// [`reviewers`](screening::reviewers) (TS `reviewers`): everyone who recorded a decision,
/// distinct reviewer ids sorted in UTF-16 order.
///
/// # Errors
///
/// Fails if `decisions` has the wrong shape.
#[wasm_bindgen(js_name = reviewers)]
pub fn reviewers_js(
    #[wasm_bindgen(unchecked_param_type = "readonly B.ScreeningDecision[]")] decisions: JsValue,
) -> JsResult<Vec<String>> {
    Ok(screening::reviewers(&decisions_from(decisions)?))
}

/// [`verdict_for`](screening::verdict_for) (TS `verdictFor`): where one item stands at one
/// stage.
///
/// # Errors
///
/// Fails if `decisions` or `stage` has the wrong shape.
#[wasm_bindgen(js_name = verdictFor, unchecked_return_type = "B.ItemVerdict")]
pub fn verdict_for_js(
    #[wasm_bindgen(unchecked_param_type = "readonly B.ScreeningDecision[]")] decisions: JsValue,
    item_id: &str,
    #[wasm_bindgen(unchecked_param_type = "B.ScreeningStage")] stage: JsValue,
) -> JsResult<JsValue> {
    let decisions = decisions_from(decisions)?;
    let stage: ScreeningStage = serde_wasm_bindgen::from_value(stage)?;
    to_js(&screening::verdict_for(&decisions, item_id, stage))
}

/// [`agreement_between`](screening::agreement_between) (TS `agreementBetween`).
///
/// # Errors
///
/// Fails if an argument has the wrong shape.
#[wasm_bindgen(js_name = agreementBetween, unchecked_return_type = "B.Agreement")]
pub fn agreement_between_js(
    #[wasm_bindgen(unchecked_param_type = "readonly B.ScreeningDecision[]")] decisions: JsValue,
    #[wasm_bindgen(unchecked_param_type = "[string, string]")] reviewers: JsValue,
    #[wasm_bindgen(unchecked_param_type = "B.ScreeningStage")] stage: JsValue,
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
#[wasm_bindgen(js_name = prismaCounts, unchecked_return_type = "B.PrismaCounts")]
pub fn prisma_counts_js(
    #[wasm_bindgen(unchecked_param_type = "readonly B.ScreeningItem[]")] items: JsValue,
    #[wasm_bindgen(unchecked_param_type = "readonly B.ScreeningDecision[]")] decisions: JsValue,
) -> JsResult<JsValue> {
    let items: Vec<ScreeningItem> = list_via_json(&items)?;
    to_js(&screening::prisma_counts(
        &items,
        &decisions_from(decisions)?,
    ))
}

/// [`decision_from_row`](screening::decision_from_row) (TS `PostgrestScreeningRepository`
/// `toDomain`): a stored `screening_decisions` row as a decision.
///
/// # Errors
///
/// Fails if `row` has the wrong shape, or its stage or state is not one the enums know.
#[wasm_bindgen(js_name = screeningDecisionFromRow, unchecked_return_type = "B.ScreeningDecision")]
pub fn screening_decision_from_row_js(
    #[wasm_bindgen(unchecked_param_type = "B.ScreeningDecisionRow")] row: JsValue,
) -> JsResult<JsValue> {
    let row: screening::ScreeningDecisionRow = serde_wasm_bindgen::from_value(row)?;
    let decision = screening::decision_from_row(&row).map_err(serde_wasm_bindgen::Error::new)?;
    to_js(&decision)
}

/// [`decision_to_row`](screening::decision_to_row) (TS `PostgrestScreeningRepository`
/// `record`): a decision as the `screening_decisions` row the table takes.
///
/// # Errors
///
/// Fails if `decision` has the wrong shape.
#[wasm_bindgen(js_name = screeningDecisionToRow, unchecked_return_type = "B.ScreeningDecisionRow")]
pub fn screening_decision_to_row_js(
    #[wasm_bindgen(unchecked_param_type = "B.ScreeningDecision")] decision: JsValue,
) -> JsResult<JsValue> {
    let decision: ScreeningDecision = serde_wasm_bindgen::from_value(decision)?;
    to_js(&screening::decision_to_row(&decision))
}

/// [`exclusion_reasons`](screening::exclusion_reasons) (TS `exclusionReasons`): why items were
/// excluded at `stage` (default `full_text`), most common first.
///
/// # Errors
///
/// Fails if `decisions` or `stage` has the wrong shape.
#[wasm_bindgen(js_name = exclusionReasons, unchecked_return_type = "B.ExclusionReasonCount[]")]
pub fn exclusion_reasons_js(
    #[wasm_bindgen(unchecked_param_type = "readonly B.ScreeningDecision[]")] decisions: JsValue,
    #[wasm_bindgen(unchecked_optional_param_type = "B.ScreeningStage")] stage: Option<JsValue>,
) -> JsResult<JsValue> {
    let decisions = decisions_from(decisions)?;
    let stage: ScreeningStage = match stage {
        Some(stage) if !stage.is_undefined() => serde_wasm_bindgen::from_value(stage)?,
        _ => ScreeningStage::FullText,
    };
    to_js(&screening::exclusion_reasons(&decisions, stage))
}
