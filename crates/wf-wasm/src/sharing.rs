//! Sharing and comment helpers for JavaScript (wf-core `sharing`). The JS names match
//! `packages/core/src/features/sharing/domain/share.ts` and `comment.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::sharing::{
    self, CommentRow, NewCommentInput, NewShareInput, ShareGrant, ShareRow, ShareScope,
    ShareableType, SharedSource,
};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`is_blanket_share`](sharing::is_blanket_share); `null` or `undefined` means every resource.
#[wasm_bindgen(js_name = isBlanketShare)]
#[allow(
    clippy::needless_pass_by_value,
    reason = "wasm_bindgen takes strings by value"
)]
pub fn is_blanket_share_js(resource_id: Option<String>) -> bool {
    sharing::is_blanket_share(resource_id.as_deref())
}

/// [`share_supports_edit_access`](sharing::share_supports_edit_access).
///
/// # Errors
///
/// Fails if `resource_type` is not a shareable type.
#[wasm_bindgen(js_name = shareSupportsEditAccess)]
#[allow(
    clippy::needless_pass_by_value,
    reason = "wasm_bindgen takes strings by value"
)]
pub fn share_supports_edit_access_js(
    resource_type: JsValue,
    resource_id: Option<String>,
) -> JsResult<bool> {
    let resource_type: ShareableType = serde_wasm_bindgen::from_value(resource_type)?;
    Ok(sharing::share_supports_edit_access(
        resource_type,
        resource_id.as_deref(),
    ))
}

/// [`share_covers_resource`](sharing::share_covers_resource).
///
/// # Errors
///
/// Fails if `share` or `resource_type` has the wrong shape.
#[wasm_bindgen(js_name = shareCoversResource)]
pub fn share_covers_resource_js(
    share: JsValue,
    resource_type: JsValue,
    resource_id: &str,
    owner_id: &str,
) -> JsResult<bool> {
    let share: ShareScope = serde_wasm_bindgen::from_value(share)?;
    let resource_type: ShareableType = serde_wasm_bindgen::from_value(resource_type)?;
    Ok(sharing::share_covers_resource(
        &share,
        resource_type,
        resource_id,
        owner_id,
    ))
}

/// [`share_allows_comment`](sharing::share_allows_comment).
///
/// # Errors
///
/// Fails if `share` or `resource_type` has the wrong shape.
#[wasm_bindgen(js_name = shareAllowsComment)]
pub fn share_allows_comment_js(
    share: JsValue,
    resource_type: JsValue,
    resource_id: &str,
    owner_id: &str,
) -> JsResult<bool> {
    let share: ShareGrant = serde_wasm_bindgen::from_value(share)?;
    let resource_type: ShareableType = serde_wasm_bindgen::from_value(resource_type)?;
    Ok(sharing::share_allows_comment(
        &share,
        resource_type,
        resource_id,
        owner_id,
    ))
}

/// [`share_allows_edit`](sharing::share_allows_edit).
///
/// # Errors
///
/// Fails if `share` or `resource_type` has the wrong shape.
#[wasm_bindgen(js_name = shareAllowsEdit)]
pub fn share_allows_edit_js(
    share: JsValue,
    resource_type: JsValue,
    resource_id: &str,
    owner_id: &str,
) -> JsResult<bool> {
    let share: ShareGrant = serde_wasm_bindgen::from_value(share)?;
    let resource_type: ShareableType = serde_wasm_bindgen::from_value(resource_type)?;
    Ok(sharing::share_allows_edit(
        &share,
        resource_type,
        resource_id,
        owner_id,
    ))
}

/// [`normalize_share_input`](sharing::normalize_share_input); a validation message throws as text.
///
/// # Errors
///
/// Fails if `input` has the wrong shape or does not validate.
#[wasm_bindgen(js_name = normalizeShareInput)]
pub fn normalize_share_input_js(input: JsValue) -> Result<JsValue, JsValue> {
    let input: NewShareInput = serde_wasm_bindgen::from_value(input)?;
    let normalized =
        sharing::normalize_share_input(&input).map_err(|message| JsValue::from_str(&message))?;
    Ok(to_js(&normalized)?)
}

/// [`normalize_comment_input`](sharing::normalize_comment_input); a message throws as text.
///
/// # Errors
///
/// Fails if `input` has the wrong shape or does not validate.
#[wasm_bindgen(js_name = normalizeCommentInput)]
pub fn normalize_comment_input_js(input: JsValue) -> Result<JsValue, JsValue> {
    let input: NewCommentInput = serde_wasm_bindgen::from_value(input)?;
    let normalized =
        sharing::normalize_comment_input(&input).map_err(|message| JsValue::from_str(&message))?;
    Ok(to_js(&normalized)?)
}

/// [`encode_share_link_token`](sharing::encode_share_link_token): unpadded base64url.
#[wasm_bindgen(js_name = encodeShareLinkToken)]
pub fn encode_share_link_token_js(token: &[u8]) -> String {
    sharing::encode_share_link_token(token)
}

/// [`decode_share_link_token`](sharing::decode_share_link_token); a bad token throws its message.
///
/// # Errors
///
/// Fails if `encoded` is not valid base64 (either alphabet).
#[wasm_bindgen(js_name = decodeShareLinkToken)]
pub fn decode_share_link_token_js(encoded: &str) -> Result<Vec<u8>, JsValue> {
    sharing::decode_share_link_token(encoded).map_err(|message| JsValue::from_str(&message))
}

/// [`share_from_row`](sharing::share_from_row): a `shares` row as the app's `Share`.
///
/// # Errors
///
/// Fails if `row` does not have the `shares` columns.
#[wasm_bindgen(js_name = shareFromRow)]
pub fn share_from_row_js(row: JsValue) -> JsResult<JsValue> {
    let row: ShareRow = serde_wasm_bindgen::from_value(row)?;
    to_js(&sharing::share_from_row(&row))
}

/// [`comment_from_row`](sharing::comment_from_row): a `comments` row as the app's `Comment`.
///
/// # Errors
///
/// Fails if `row` does not have the `comments` columns.
#[wasm_bindgen(js_name = commentFromRow)]
pub fn comment_from_row_js(row: JsValue) -> JsResult<JsValue> {
    let row: CommentRow = serde_wasm_bindgen::from_value(row)?;
    to_js(&sharing::comment_from_row(&row))
}

/// [`shared_item`](sharing::shared_item): one table row as a `SharedItem`.
///
/// # Errors
///
/// Fails if `kind` is not a shareable type or `source` lacks `title`.
#[wasm_bindgen(js_name = sharedItem)]
pub fn shared_item_js(kind: JsValue, row: JsValue, source: JsValue) -> JsResult<JsValue> {
    let kind: ShareableType = serde_wasm_bindgen::from_value(kind)?;
    let row: serde_json::Value = serde_wasm_bindgen::from_value(row)?;
    let source: SharedSource = serde_wasm_bindgen::from_value(source)?;
    to_js(&sharing::shared_item(kind, &row, &source))
}
