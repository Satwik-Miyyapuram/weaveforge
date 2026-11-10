//! The Mattermost post rules for JavaScript (wf-core `sync::mattermost_post`). The JS names
//! `mattermostPostPlan`, `mattermostPostResponsePlan` and `mattermostTestPosts` are wrapped by
//! `packages/wf-wasm/src/sync-mattermost-post.ts`, which
//! `features/sync/infrastructure/mattermost-notifier.ts` and `mattermost-test-post.ts` call.

use serde_wasm_bindgen::Error;
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::sync::integration_fields::Integration;
use wf_core::sync::mattermost_post::{
    MattermostPostInput, MattermostPostResponse, post_plan, post_response_plan, test_posts,
};

use super::to_js;

type JsResult<T> = Result<T, Error>;

/// [`post_plan`] for JS (TS `mattermostPostPlan`).
///
/// # Errors
///
/// Fails when `input` is not a Mattermost post input with the expected fields.
#[wasm_bindgen(js_name = mattermostPostPlan, unchecked_return_type = "B.MattermostPostPlan")]
pub fn post_plan_js(
    #[wasm_bindgen(unchecked_param_type = "B.MattermostPostInput")] input: JsValue,
) -> JsResult<JsValue> {
    let input: MattermostPostInput = serde_wasm_bindgen::from_value(input)?;
    to_js(&post_plan(&input))
}

/// [`post_response_plan`] for JS (TS `mattermostPostResponsePlan`).
///
/// # Errors
///
/// Fails when `input` is not a status and body with the expected fields.
#[wasm_bindgen(js_name = mattermostPostResponsePlan, unchecked_return_type = "B.MattermostPostResponsePlan")]
pub fn post_response_plan_js(
    #[wasm_bindgen(unchecked_param_type = "B.MattermostPostResponse")] input: JsValue,
) -> JsResult<JsValue> {
    let input: MattermostPostResponse = serde_wasm_bindgen::from_value(input)?;
    to_js(&post_response_plan(&input))
}

/// [`test_posts`] for JS (TS `mattermostTestPosts`).
///
/// # Errors
///
/// Fails when `integration` is not a sync integration with the expected fields.
#[wasm_bindgen(js_name = mattermostTestPosts, unchecked_return_type = "B.MattermostTestPost[]")]
pub fn test_posts_js(
    #[wasm_bindgen(unchecked_param_type = "B.Integration")] integration: JsValue,
) -> JsResult<JsValue> {
    let integration: Integration = serde_wasm_bindgen::from_value(integration)?;
    to_js(&test_posts(&integration))
}
