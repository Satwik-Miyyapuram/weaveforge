//! AI write-proposal payload readers for JavaScript (wf-core `ai::proposal_inputs`). The JS names
//! match `apps/web/src/features/ai-assistant/application/proposal-executors.ts`. A refused payload
//! throws a `JsError` with the TS message verbatim.

use serde::Serialize;
use serde_json::Value;
use wasm_bindgen::JsError;
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::ai::proposal_inputs::{self, PaperFieldDefInput};

use super::to_js;

type JsResult<T> = Result<T, JsError>;

fn read_payload(payload: JsValue) -> JsResult<Value> {
    serde_wasm_bindgen::from_value(payload).map_err(|e| JsError::new(&e.to_string()))
}

fn finish<T: Serialize>(result: Result<T, String>) -> JsResult<JsValue> {
    let value = result.map_err(|message| JsError::new(&message))?;
    to_js(&value).map_err(|e| JsError::new(&e.to_string()))
}

/// [`paper_note_addition`](proposal_inputs::paper_note_addition): the addition, else `content`.
#[wasm_bindgen(js_name = proposalPaperNoteAddition)]
pub fn proposal_paper_note_addition(
    #[wasm_bindgen(unchecked_param_type = "unknown")] payload: JsValue,
    content: &str,
) -> JsResult<String> {
    Ok(proposal_inputs::paper_note_addition(
        &read_payload(payload)?,
        content,
    ))
}

/// [`vault_note`](proposal_inputs::vault_note): `create_vault_note` input.
#[wasm_bindgen(js_name = proposalVaultNote, unchecked_return_type = "B.VaultNoteInput")]
pub fn proposal_vault_note(
    #[wasm_bindgen(unchecked_param_type = "unknown")] payload: JsValue,
) -> JsResult<JsValue> {
    finish(proposal_inputs::vault_note(&read_payload(payload)?))
}

/// [`log_entry`](proposal_inputs::log_entry): `create_log_entry` input.
#[wasm_bindgen(js_name = proposalLogEntry, unchecked_return_type = "B.ProposalLogEntryInput")]
pub fn proposal_log_entry(
    #[wasm_bindgen(unchecked_param_type = "unknown")] payload: JsValue,
) -> JsResult<JsValue> {
    finish(proposal_inputs::log_entry(&read_payload(payload)?))
}

/// [`paper_update`](proposal_inputs::paper_update): `paper_update` input.
#[wasm_bindgen(js_name = proposalPaperUpdate, unchecked_return_type = "B.PaperUpdateInput")]
pub fn proposal_paper_update(
    #[wasm_bindgen(unchecked_param_type = "unknown")] payload: JsValue,
) -> JsResult<JsValue> {
    finish(proposal_inputs::paper_update(&read_payload(payload)?))
}

/// [`paper_field_id`](proposal_inputs::paper_field_id): the `fieldId`, read before the field list.
#[wasm_bindgen(js_name = proposalPaperFieldId)]
pub fn proposal_paper_field_id(
    #[wasm_bindgen(unchecked_param_type = "unknown")] payload: JsValue,
) -> JsResult<String> {
    proposal_inputs::paper_field_id(&read_payload(payload)?)
        .map_err(|message| JsError::new(&message))
}

/// [`paper_field_fill`](proposal_inputs::paper_field_fill): the checked field write.
///
/// # Errors
///
/// Throws for an unknown field, a non-fillable kind, a refused value, or an option not allowed.
#[wasm_bindgen(js_name = proposalPaperFieldFill)]
pub fn proposal_paper_field_fill(payload: JsValue, defs: JsValue) -> JsResult<JsValue> {
    let defs: Vec<PaperFieldDefInput> =
        serde_wasm_bindgen::from_value(defs).map_err(|e| JsError::new(&e.to_string()))?;
    finish(proposal_inputs::paper_field_fill(
        &read_payload(payload)?,
        &defs,
    ))
}

/// [`reading_list_change`](proposal_inputs::reading_list_change): exactly one target.
#[wasm_bindgen(js_name = proposalReadingListChange, unchecked_return_type = "B.ReadingListChangeInput")]
pub fn proposal_reading_list_change(
    #[wasm_bindgen(unchecked_param_type = "unknown")] payload: JsValue,
) -> JsResult<JsValue> {
    finish(proposal_inputs::reading_list_change(&read_payload(
        payload,
    )?))
}

/// [`relation_change`](proposal_inputs::relation_change): `relation` input.
#[wasm_bindgen(js_name = proposalRelation, unchecked_return_type = "B.RelationInput")]
pub fn proposal_relation(
    #[wasm_bindgen(unchecked_param_type = "unknown")] payload: JsValue,
) -> JsResult<JsValue> {
    finish(proposal_inputs::relation_change(&read_payload(payload)?))
}

/// [`zotero_import`](proposal_inputs::zotero_import): the paper fields a Zotero draft may set.
#[wasm_bindgen(js_name = proposalZoteroImport, unchecked_return_type = "B.ProposalZoteroPaperInput")]
pub fn proposal_zotero_import(
    #[wasm_bindgen(unchecked_param_type = "unknown")] payload: JsValue,
) -> JsResult<JsValue> {
    finish(proposal_inputs::zotero_import(&read_payload(payload)?))
}

/// [`milestone_follow_up`](proposal_inputs::milestone_follow_up): `milestone` input.
#[wasm_bindgen(js_name = proposalMilestoneFollowUp, unchecked_return_type = "B.ProposalMilestoneInput")]
pub fn proposal_milestone_follow_up(
    #[wasm_bindgen(unchecked_param_type = "unknown")] payload: JsValue,
) -> JsResult<JsValue> {
    finish(proposal_inputs::milestone_follow_up(&read_payload(
        payload,
    )?))
}

/// [`experiment_follow_up`](proposal_inputs::experiment_follow_up): `experiment` input.
#[wasm_bindgen(js_name = proposalExperimentFollowUp, unchecked_return_type = "B.ExperimentFollowUpInput")]
pub fn proposal_experiment_follow_up(
    #[wasm_bindgen(unchecked_param_type = "unknown")] payload: JsValue,
) -> JsResult<JsValue> {
    finish(proposal_inputs::experiment_follow_up(&read_payload(
        payload,
    )?))
}

/// [`edit_vault_note`](proposal_inputs::edit_vault_note): the title and/or body to set.
#[wasm_bindgen(js_name = proposalEditVaultNote, unchecked_return_type = "B.VaultNoteEditInput")]
pub fn proposal_edit_vault_note(
    #[wasm_bindgen(unchecked_param_type = "unknown")] payload: JsValue,
) -> JsResult<JsValue> {
    finish(proposal_inputs::edit_vault_note(&read_payload(payload)?))
}

/// [`append_vault_note_body`](proposal_inputs::append_vault_note_body): the note's new body.
#[wasm_bindgen(js_name = proposalAppendVaultNoteBody)]
pub fn proposal_append_vault_note_body(
    existing: &str,
    #[wasm_bindgen(unchecked_param_type = "unknown")] payload: JsValue,
) -> JsResult<String> {
    proposal_inputs::append_vault_note_body(existing, &read_payload(payload)?)
        .map_err(|message| JsError::new(&message))
}

/// [`report_notes`](proposal_inputs::report_notes): the notes to set on a report section.
#[wasm_bindgen(js_name = proposalReportNotes)]
pub fn proposal_report_notes(
    #[wasm_bindgen(unchecked_param_type = "unknown")] payload: JsValue,
) -> JsResult<String> {
    proposal_inputs::report_notes(&read_payload(payload)?).map_err(|message| JsError::new(&message))
}

/// [`milestone_status`](proposal_inputs::milestone_status): the status to set.
#[wasm_bindgen(js_name = proposalMilestoneStatus)]
pub fn proposal_milestone_status(
    #[wasm_bindgen(unchecked_param_type = "unknown")] payload: JsValue,
) -> JsResult<String> {
    proposal_inputs::milestone_status(&read_payload(payload)?)
        .map_err(|message| JsError::new(&message))
}

/// [`experiment_update`](proposal_inputs::experiment_update): status, metrics and artifacts.
#[wasm_bindgen(js_name = proposalExperimentUpdate)]
pub fn proposal_experiment_update(payload: JsValue) -> JsResult<JsValue> {
    finish(proposal_inputs::experiment_update(&read_payload(payload)?))
}

/// [`paper_annotation`](proposal_inputs::paper_annotation): the quote-anchored annotation input.
#[wasm_bindgen(js_name = proposalPaperAnnotation, unchecked_return_type = "B.PaperAnnotationInput")]
pub fn proposal_paper_annotation(
    #[wasm_bindgen(unchecked_param_type = "unknown")] payload: JsValue,
) -> JsResult<JsValue> {
    finish(proposal_inputs::paper_annotation(&read_payload(payload)?))
}
