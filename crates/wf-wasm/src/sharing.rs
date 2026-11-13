//! Sharing and comment helpers for JavaScript (wf-core `sharing`). The JS names match
//! `packages/core/src/features/sharing/domain/share.ts` and `comment.ts`.

use wasm_bindgen::prelude::wasm_bindgen;
use wasm_bindgen::{JsCast, JsValue};
use wf_core::sharing::{
    self, CommentRow, NewCommentInput, NewShareInput, ShareGrant, ShareScope, ShareableType,
    SharedSource,
};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`is_blanket_share`](sharing::is_blanket_share); `null` or `undefined` means every resource.
#[wasm_bindgen(js_name = isBlanketShare)]
#[allow(
    clippy::needless_pass_by_value,
    reason = "wasm_bindgen takes strings by value"
)]
pub fn is_blanket_share_js(
    #[wasm_bindgen(unchecked_optional_param_type = "string | null | undefined")]
    resource_id: Option<String>,
) -> bool {
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
    #[wasm_bindgen(unchecked_param_type = "B.ShareableType")] resource_type: JsValue,
    #[wasm_bindgen(unchecked_optional_param_type = "string | null | undefined")]
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
    #[wasm_bindgen(
        unchecked_param_type = "Pick<B.Share, \"resourceType\" | \"resourceId\" | \"ownerId\">"
    )]
    share: JsValue,
    #[wasm_bindgen(unchecked_param_type = "B.ShareableType")] resource_type: JsValue,
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
    #[wasm_bindgen(
        unchecked_param_type = "Pick<B.Share, \"resourceType\" | \"resourceId\" | \"ownerId\" | \"access\">"
    )]
    share: JsValue,
    #[wasm_bindgen(unchecked_param_type = "B.ShareableType")] resource_type: JsValue,
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
    #[wasm_bindgen(
        unchecked_param_type = "Pick<B.Share, \"resourceType\" | \"resourceId\" | \"ownerId\" | \"access\">"
    )]
    share: JsValue,
    #[wasm_bindgen(unchecked_param_type = "B.ShareableType")] resource_type: JsValue,
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

/// A thrown value as an `Error` named like the TS validation class: an unnamed `Error` (from
/// serde) is renamed, a message becomes a new `Error`, anything else passes through.
fn named_error(thrown: JsValue, name: &str) -> JsValue {
    if let Some(error) = thrown.dyn_ref::<js_sys::Error>() {
        if error.name() == "Error" {
            error.set_name(name);
        }
        return thrown;
    }
    match thrown.as_string() {
        Some(message) => {
            let error = js_sys::Error::new(&message);
            error.set_name(name);
            error.into()
        }
        None => thrown,
    }
}

/// [`normalize_share_input`](sharing::normalize_share_input). A grant to a recipient with an
/// unknown resource type is refused before parsing, as the TS rule did.
///
/// # Errors
///
/// Throws an `Error` named `ShareValidationError` if `input` has the wrong shape or does not
/// validate.
#[wasm_bindgen(js_name = normalizeShareInput, unchecked_return_type = "Required<B.NewShareInput>")]
pub fn normalize_share_input_js(
    #[wasm_bindgen(unchecked_param_type = "B.NewShareInput")] input: JsValue,
) -> Result<JsValue, JsValue> {
    let named = |thrown: JsValue| named_error(thrown, "ShareValidationError");
    let recipient =
        js_sys::Reflect::get(&input, &JsValue::from_str("recipientId")).map_err(named)?;
    if recipient.is_truthy() {
        let kind =
            js_sys::Reflect::get(&input, &JsValue::from_str("resourceType")).map_err(named)?;
        if let Some(kind) = kind.as_string() {
            let known: Result<ShareableType, _> =
                serde_wasm_bindgen::from_value(JsValue::from_str(&kind));
            if known.is_err() {
                return Err(named(JsValue::from_str(&format!(
                    "Unknown resource type \"{kind}\"."
                ))));
            }
        }
    }
    let input: NewShareInput =
        serde_wasm_bindgen::from_value(input).map_err(|error| named(error.into()))?;
    let normalized = sharing::normalize_share_input(&input)
        .map_err(|message| named(JsValue::from_str(&message)))?;
    to_js(&normalized).map_err(|error| named(error.into()))
}

/// [`normalize_comment_input`](sharing::normalize_comment_input).
///
/// # Errors
///
/// Throws an `Error` named `CommentValidationError` if `input` has the wrong shape or does not
/// validate.
#[wasm_bindgen(js_name = normalizeCommentInput, unchecked_return_type = "B.NewCommentInput")]
pub fn normalize_comment_input_js(
    #[wasm_bindgen(unchecked_param_type = "B.NewCommentInput")] input: JsValue,
) -> Result<JsValue, JsValue> {
    let named = |thrown: JsValue| named_error(thrown, "CommentValidationError");
    let input: NewCommentInput =
        serde_wasm_bindgen::from_value(input).map_err(|error| named(error.into()))?;
    let normalized = sharing::normalize_comment_input(&input)
        .map_err(|message| named(JsValue::from_str(&message)))?;
    to_js(&normalized).map_err(|error| named(error.into()))
}

/// [`encode_share_link_token`](sharing::encode_share_link_token): unpadded base64url.
#[wasm_bindgen(js_name = encodeShareLinkToken)]
pub fn encode_share_link_token_js(token: &[u8]) -> String {
    sharing::encode_share_link_token(token)
}

/// [`decode_share_link_token`](sharing::decode_share_link_token): the token's bytes; accepts
/// either base64 alphabet, padded or not.
///
/// # Errors
///
/// Throws an `Error` named `InvalidCharacterError` if `encoded` is not valid base64.
#[wasm_bindgen(js_name = decodeShareLinkToken)]
pub fn decode_share_link_token_js(encoded: &str) -> Result<Vec<u8>, JsValue> {
    sharing::decode_share_link_token(encoded)
        .map_err(|message| named_error(JsValue::from_str(&message), "InvalidCharacterError"))
}

/// [`comment_from_row`](sharing::comment_from_row): a `comments` row as the app's `Comment`.
///
/// # Errors
///
/// Fails if `row` does not have the `comments` columns.
#[wasm_bindgen(js_name = commentFromRow, unchecked_return_type = "B.Comment")]
pub fn comment_from_row_js(
    #[wasm_bindgen(unchecked_param_type = "B.CommentRow")] row: JsValue,
) -> JsResult<JsValue> {
    let row: CommentRow = serde_wasm_bindgen::from_value(row)?;
    to_js(&sharing::comment_from_row(&row))
}

/// [`shared_item`](sharing::shared_item): one table row as a `SharedItem`.
///
/// # Errors
///
/// Fails if `kind` is not a shareable type or `source` lacks `title`.
#[wasm_bindgen(js_name = sharedItem, unchecked_return_type = "B.SharedItem")]
pub fn shared_item_js(
    #[wasm_bindgen(unchecked_param_type = "B.ShareableType")] kind: JsValue,
    #[wasm_bindgen(unchecked_param_type = "Record<string, unknown>")] row: JsValue,
    #[wasm_bindgen(unchecked_param_type = "B.SharedSource")] source: JsValue,
) -> JsResult<JsValue> {
    let kind: ShareableType = serde_wasm_bindgen::from_value(kind)?;
    let row: serde_json::Value = serde_wasm_bindgen::from_value(row)?;
    let source: SharedSource = serde_wasm_bindgen::from_value(source)?;
    to_js(&sharing::shared_item(kind, &row, &source))
}

/// [`member_name_map`](wf_core::member::member_name_map) as a `Map` from member id to display
/// name: full name, else email, else `"Member"`.
///
/// # Errors
///
/// Fails when `members` is not a list of member sources.
#[wasm_bindgen(js_name = memberNameMap, unchecked_return_type = "Map<string, string>")]
pub fn member_name_map_js(
    #[wasm_bindgen(unchecked_param_type = "readonly B.MemberNameSource[]")] members: JsValue,
) -> JsResult<JsValue> {
    let members: Vec<wf_core::member::MemberNameSource> = serde_wasm_bindgen::from_value(members)?;
    let names = js_sys::Map::new();
    for member in wf_core::member::member_name_map(&members) {
        let _ = names.set(
            &JsValue::from_str(&member.id),
            &JsValue::from_str(&member.name),
        );
    }
    Ok(names.into())
}

/// [`shared_resource_href`](sharing::shared_resource_href).
///
/// # Errors
///
/// Fails when `kind` is not a shareable type.
#[wasm_bindgen(js_name = sharedResourceHref)]
pub fn shared_resource_href_js(
    #[wasm_bindgen(unchecked_param_type = "B.ShareableType")] kind: JsValue,
    resource_id: &str,
) -> JsResult<String> {
    let kind: ShareableType = serde_wasm_bindgen::from_value(kind)?;
    Ok(sharing::shared_resource_href(kind, resource_id))
}

/// [`shared_item_href`](sharing::shared_item_href).
///
/// # Errors
///
/// Fails when `item` is not a shared item.
#[wasm_bindgen(js_name = sharedItemHref)]
pub fn shared_item_href_js(
    #[wasm_bindgen(unchecked_param_type = "B.SharedItem")] item: JsValue,
) -> JsResult<String> {
    let item: sharing::SharedItem = serde_wasm_bindgen::from_value(item)?;
    Ok(sharing::shared_item_href(&item))
}

/// [`shared_item_type_label`](sharing::shared_item_type_label).
///
/// # Errors
///
/// Fails when `kind` is not a shareable type.
#[wasm_bindgen(js_name = sharedItemTypeLabel)]
pub fn shared_item_type_label_js(
    #[wasm_bindgen(unchecked_param_type = "B.ShareableType")] kind: JsValue,
) -> JsResult<String> {
    let kind: ShareableType = serde_wasm_bindgen::from_value(kind)?;
    Ok(sharing::shared_item_type_label(kind))
}

/// [`shared_paper_annotation_summary`](sharing::shared_paper_annotation_summary).
///
/// # Errors
///
/// Fails when `metadata` is not JSON, or the summary cannot be converted to a JS value.
#[wasm_bindgen(
    js_name = sharedPaperAnnotationSummary,
    unchecked_return_type = "B.SharedPaperAnnotationSummary"
)]
pub fn shared_paper_annotation_summary_js(
    #[wasm_bindgen(unchecked_param_type = "Record<string, unknown> | undefined")] metadata: JsValue,
) -> JsResult<JsValue> {
    let metadata: Option<serde_json::Value> = serde_wasm_bindgen::from_value(metadata)?;
    to_js(&sharing::shared_paper_annotation_summary(metadata.as_ref()))
}

/// [`default_share_link_expires_at`](sharing::default_share_link_expires_at): the default expiry
/// of a new view link. `now_ms` is the JS `Date.now()` value.
#[must_use]
#[allow(
    clippy::cast_possible_truncation,
    reason = "epoch milliseconds are whole numbers well inside i64"
)]
#[wasm_bindgen(js_name = defaultShareLinkExpiresAt)]
pub fn default_share_link_expires_at_js(now_ms: f64) -> String {
    sharing::default_share_link_expires_at(now_ms as i64)
}

/// [`shared_read_plan`](sharing::shared_read_plan): the PostgREST table, columns and filter for
/// one shared read, or `null` when there is no id and no owner.
///
/// # Errors
///
/// Fails if `kind` is not a shareable type or `ids`/`owners` are not string lists.
#[wasm_bindgen(js_name = sharedReadPlan, unchecked_return_type = "B.SharedReadPlan | null")]
pub fn shared_read_plan_js(
    #[wasm_bindgen(unchecked_param_type = "B.ShareableType")] kind: JsValue,
    #[wasm_bindgen(unchecked_param_type = "readonly string[]")] ids: JsValue,
    #[wasm_bindgen(unchecked_param_type = "readonly string[]")] owners: JsValue,
) -> JsResult<JsValue> {
    let kind: ShareableType = serde_wasm_bindgen::from_value(kind)?;
    let ids: Vec<String> = serde_wasm_bindgen::from_value(ids)?;
    let owners: Vec<String> = serde_wasm_bindgen::from_value(owners)?;
    to_js(&sharing::shared_read_plan(kind, &ids, &owners))
}

/// [`share_targets`](sharing::share_targets): the ids and blanket owners of one type in a grant list.
///
/// # Errors
///
/// Fails if `kind` is not a shareable type or `shares` is not a list of shares.
#[wasm_bindgen(js_name = shareTargets, unchecked_return_type = "B.ShareTargets")]
pub fn share_targets_js(
    #[wasm_bindgen(unchecked_param_type = "readonly B.Share[]")] shares: JsValue,
    #[wasm_bindgen(unchecked_param_type = "B.ShareableType")] kind: JsValue,
) -> JsResult<JsValue> {
    let shares: Vec<sharing::Share> = serde_wasm_bindgen::from_value(shares)?;
    let kind: ShareableType = serde_wasm_bindgen::from_value(kind)?;
    to_js(&sharing::share_targets(&shares, kind))
}

/// [`SHAREABLE_TYPES`](sharing::SHAREABLE_TYPES): every type a share can cover.
///
/// # Errors
///
/// Fails if the list cannot be converted to a JS value.
#[wasm_bindgen(js_name = shareableTypes, unchecked_return_type = "readonly B.ShareableType[]")]
pub fn shareable_types_js() -> JsResult<JsValue> {
    to_js(&sharing::SHAREABLE_TYPES)
}

/// [`CRDT_EDITABLE_SHARE_TYPES`](sharing::CRDT_EDITABLE_SHARE_TYPES): share types that support
/// collaborative editing.
///
/// # Errors
///
/// Fails if the list cannot be converted to a JS value.
#[wasm_bindgen(js_name = crdtEditableShareTypes, unchecked_return_type = "readonly B.ShareableType[]")]
pub fn crdt_editable_share_types_js() -> JsResult<JsValue> {
    to_js(&sharing::CRDT_EDITABLE_SHARE_TYPES)
}

/// [`SHARE_LINK_DEFAULT_TTL_DAYS`](sharing::SHARE_LINK_DEFAULT_TTL_DAYS) as a JS number.
#[must_use]
#[allow(
    clippy::cast_precision_loss,
    reason = "a day count is a small whole number, exact in f64"
)]
#[wasm_bindgen(js_name = shareLinkDefaultTtlDays)]
pub fn share_link_default_ttl_days_js() -> f64 {
    sharing::SHARE_LINK_DEFAULT_TTL_DAYS as f64
}
