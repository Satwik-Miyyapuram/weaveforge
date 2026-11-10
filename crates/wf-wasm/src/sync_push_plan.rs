//! Push and pull gates for the offline-sync engine, for JavaScript (wf-core `sync::push_plan`).
//! The JS names `continuePushRound`, `shouldRecoverUnsent`, `groupEligible`,
//! `shouldPullAfterPush`, `shouldFetchNextPage` and `tableGroups` are wrapped by
//! `packages/wf-wasm/src/sync-push-plan.ts`, called from `domain/sync-engine.ts` and `domain/puller.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::sync::push_plan::{
    continue_push_round, group_eligible, should_fetch_next_page, should_pull_after_push,
    should_recover_unsent, table_groups,
};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`continue_push_round`] for JS (TS `continuePushRound`).
#[wasm_bindgen(js_name = continuePushRound)]
pub fn continue_push_round_js(sent: usize, stopped_early: bool) -> bool {
    continue_push_round(sent, stopped_early)
}

/// [`should_recover_unsent`] for JS (TS `shouldRecoverUnsent`).
#[wasm_bindgen(js_name = shouldRecoverUnsent)]
pub fn should_recover_unsent_js(has_account: bool, resend_checked: bool) -> bool {
    should_recover_unsent(has_account, resend_checked)
}

/// [`group_eligible`] for JS (TS `groupEligible`).
#[wasm_bindgen(js_name = groupEligible)]
pub fn group_eligible_js(deleted: bool, unique_clash: bool, pending_ops: usize) -> bool {
    group_eligible(deleted, unique_clash, pending_ops)
}

/// [`should_pull_after_push`] for JS (TS `shouldPullAfterPush`).
#[wasm_bindgen(js_name = shouldPullAfterPush)]
pub fn should_pull_after_push_js(stopped_offline: bool) -> bool {
    should_pull_after_push(stopped_offline)
}

/// [`should_fetch_next_page`] for JS (TS `shouldFetchNextPage`).
#[wasm_bindgen(js_name = shouldFetchNextPage)]
pub fn should_fetch_next_page_js(more: bool, page: usize, max_pages: usize) -> bool {
    should_fetch_next_page(more, page, max_pages)
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
