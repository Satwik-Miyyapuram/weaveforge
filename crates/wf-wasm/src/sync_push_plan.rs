//! Push and pull gates for the offline-sync engine, for JavaScript (wf-core `sync::push_plan`).
//! The JS names `continuePushRound`, `shouldRecoverUnsent`, `groupEligible`,
//! `shouldPullAfterPush`, `shouldFetchNextPage` and `tableGroups` are wrapped by
//! `packages/wf-wasm/src/wrappers-11.ts`, called from `domain/sync-engine.ts` and `domain/puller.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::sync::push_plan::{
    continue_push_round, group_eligible, should_fetch_next_page, should_pull_after_push,
    should_recover_unsent, table_groups,
};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// `continuePushRound` input.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct RoundIn {
    sent: usize,
    stopped_early: bool,
}

/// `shouldRecoverUnsent` input.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct RecoverIn {
    has_account: bool,
    resend_checked: bool,
}

/// `groupEligible` input.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct EligibleIn {
    deleted: bool,
    unique_clash: bool,
    pending_ops: usize,
}

/// `shouldPullAfterPush` input.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct PullIn {
    stopped_offline: bool,
}

/// `shouldFetchNextPage` input.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct PageIn {
    more: bool,
    page: usize,
    max_pages: usize,
}

/// [`continue_push_round`] for JS (TS `continuePushRound`): whether the push loop runs another
/// round.
///
/// # Errors
///
/// Fails when `input` is not `{ sent, stoppedEarly }` with a whole `sent`.
#[wasm_bindgen(js_name = continuePushRound)]
pub fn continue_push_round_js(
    #[wasm_bindgen(unchecked_param_type = "{ sent: number; stoppedEarly: boolean }")]
    input: JsValue,
) -> JsResult<bool> {
    let input: RoundIn = serde_wasm_bindgen::from_value(input)?;
    Ok(continue_push_round(input.sent, input.stopped_early))
}

/// [`should_recover_unsent`] for JS (TS `shouldRecoverUnsent`): whether unsent local rows are
/// checked against the server.
///
/// # Errors
///
/// Fails when `input` is not `{ hasAccount, resendChecked }`.
#[wasm_bindgen(js_name = shouldRecoverUnsent)]
pub fn should_recover_unsent_js(
    #[wasm_bindgen(unchecked_param_type = "{ hasAccount: boolean; resendChecked: boolean }")]
    input: JsValue,
) -> JsResult<bool> {
    let input: RecoverIn = serde_wasm_bindgen::from_value(input)?;
    Ok(should_recover_unsent(
        input.has_account,
        input.resend_checked,
    ))
}

/// [`group_eligible`] for JS (TS `groupEligible`): whether a refused pull may land in a
/// table-wide group.
///
/// # Errors
///
/// Fails when `input` is not `{ deleted, uniqueClash, pendingOps }` with a whole `pendingOps`.
#[wasm_bindgen(js_name = groupEligible)]
pub fn group_eligible_js(
    #[wasm_bindgen(
        unchecked_param_type = "{ deleted: boolean; uniqueClash: boolean; pendingOps: number }"
    )]
    input: JsValue,
) -> JsResult<bool> {
    let input: EligibleIn = serde_wasm_bindgen::from_value(input)?;
    Ok(group_eligible(
        input.deleted,
        input.unique_clash,
        input.pending_ops,
    ))
}

/// [`should_pull_after_push`] for JS (TS `shouldPullAfterPush`): whether the pull runs after a
/// push (not when the network stopped the push).
///
/// # Errors
///
/// Fails when `input` is not `{ stoppedOffline }`.
#[wasm_bindgen(js_name = shouldPullAfterPush)]
pub fn should_pull_after_push_js(
    #[wasm_bindgen(unchecked_param_type = "{ stoppedOffline: boolean }")] input: JsValue,
) -> JsResult<bool> {
    let input: PullIn = serde_wasm_bindgen::from_value(input)?;
    Ok(should_pull_after_push(input.stopped_offline))
}

/// [`should_fetch_next_page`] for JS (TS `shouldFetchNextPage`): whether the cycle fetches
/// another page; `page` counts the pulls already made.
///
/// # Errors
///
/// Fails when `input` is not `{ more, page, maxPages }` with whole counts.
#[wasm_bindgen(js_name = shouldFetchNextPage)]
pub fn should_fetch_next_page_js(
    #[wasm_bindgen(unchecked_param_type = "{ more: boolean; page: number; maxPages: number }")]
    input: JsValue,
) -> JsResult<bool> {
    let input: PageIn = serde_wasm_bindgen::from_value(input)?;
    Ok(should_fetch_next_page(
        input.more,
        input.page,
        input.max_pages,
    ))
}

/// [`table_groups`] for JS (TS `tableGroups`).
///
/// # Errors
///
/// Fails when `tables` is not an array of strings.
#[wasm_bindgen(js_name = tableGroups, unchecked_return_type = "number[][]")]
pub fn table_groups_js(
    #[wasm_bindgen(unchecked_param_type = "string[]")] tables: JsValue,
) -> JsResult<JsValue> {
    let tables: Vec<String> = serde_wasm_bindgen::from_value(tables)?;
    to_js(&table_groups(&tables))
}
