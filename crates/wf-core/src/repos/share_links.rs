//! The `share_links` repository as Rust-planned queries.
//!
//! Ported from `apps/web/src/features/sharing/infrastructure/postgrest-share-link-repository.ts`.
//! `token_hash`, `dek_wrap` and `dek_epoch` are written and never selected back, so a minted
//! link's reply carries no key material. Byte arguments arrive as JSON number arrays.

use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::bytea::{decode_base64, encode_bytea};
use crate::repo_query::{RepoCall, RepoQuery, RepoStep, map_row, map_rows};
use crate::sharing::{ShareAccess, ShareLinkRow, ShareableType, share_link_from_row};

const TABLE: &str = "share_links";

/// The columns a minted link is read back as, named rather than starred.
pub const SHARE_LINK_COLUMNS: &str =
    "id,owner_id,resource_type,resource_id,access,expires_at,created_at";

/// The next step of `method`, or `None` for an unknown method.
#[must_use]
pub fn step(method: &str, call: &RepoCall) -> Option<RepoStep> {
    Some(match method {
        "getById" => get_by_id(call),
        "listForResource" => list_for_resource(call),
        "save" => save(call),
        "delete" => delete(call),
        "redeem" => redeem(call),
        _ => return None,
    })
}

/// `ShareLinkSaveInput`, camelCase as the TS sender passes it.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveInput {
    id: String,
    owner_id: String,
    resource_type: ShareableType,
    resource_id: String,
    access: ShareAccess,
    token_hash: Vec<u8>,
    expires_at: Option<String>,
    dek_wrap: Option<Vec<u8>>,
    dek_epoch: Option<i64>,
}

/// The `redeem_share_link` reply, camelCase as the RPC returns it; `dekWrap` is base64.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RedeemRow {
    id: String,
    owner_id: String,
    resource_type: ShareableType,
    resource_id: String,
    access: ShareAccess,
    dek_wrap: Option<String>,
    dek_epoch: Option<i64>,
}

/// A redeemed link as the app reads it (TS `ResolvedShareLink`).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ResolvedShareLink {
    id: String,
    owner_id: String,
    resource_type: ShareableType,
    resource_id: String,
    access: ShareAccess,
    dek_wrap: Option<Vec<u8>>,
    dek_epoch: Option<i64>,
}

/// `getById(id)`: the link, or `null`.
fn get_by_id(call: &RepoCall) -> RepoStep {
    if call.replies.is_empty() {
        return RepoStep::send(
            RepoQuery::select(TABLE, SHARE_LINK_COLUMNS)
                .eq("id", call.text(0))
                .maybe_single(),
        );
    }
    match call.reply::<Option<ShareLinkRow>>(0) {
        Some(Ok(row)) => RepoStep::done(&row.as_ref().map(share_link_from_row)),
        Some(Err(e)) => RepoStep::fail(e),
        None => RepoStep::fail("reply 0 missing"),
    }
}

/// `listForResource(resourceType, resourceId)`: newest first.
fn list_for_resource(call: &RepoCall) -> RepoStep {
    if call.replies.is_empty() {
        return RepoStep::send(
            RepoQuery::select(TABLE, SHARE_LINK_COLUMNS)
                .eq("resource_type", call.text(0))
                .eq("resource_id", call.text(1))
                .order("created_at", false),
        );
    }
    map_rows(call, 0, share_link_from_row)
}

/// `save(input)`: the stored link.
fn save(call: &RepoCall) -> RepoStep {
    if call.replies.is_empty() {
        let input: SaveInput = match call.parse(0) {
            Ok(input) => input,
            Err(e) => return RepoStep::fail(e),
        };
        return RepoStep::send(
            RepoQuery::insert(
                TABLE,
                json!({
                    "id": input.id,
                    "owner_id": input.owner_id,
                    "resource_type": input.resource_type,
                    "resource_id": input.resource_id,
                    "access": input.access,
                    "token_hash": encode_bytea(&input.token_hash),
                    "expires_at": input.expires_at,
                    "dek_wrap": input.dek_wrap.as_deref().map(encode_bytea),
                    "dek_epoch": input.dek_epoch,
                }),
            )
            .returning(SHARE_LINK_COLUMNS)
            .single(),
        );
    }
    map_row(call, 0, share_link_from_row)
}

/// `delete(id)`.
fn delete(call: &RepoCall) -> RepoStep {
    if call.replies.is_empty() {
        return RepoStep::send(RepoQuery::delete(TABLE).eq("id", call.text(0)));
    }
    RepoStep::unit()
}

/// `redeem(tokenHash)`: the resolved link, or `null`. An empty `dekWrap` reads as no key.
fn redeem(call: &RepoCall) -> RepoStep {
    if call.replies.is_empty() {
        let token_hash: Vec<u8> = match call.parse(0) {
            Ok(bytes) => bytes,
            Err(e) => return RepoStep::fail(e),
        };
        return RepoStep::send(RepoQuery::rpc(
            "redeem_share_link",
            json!({ "p_token_hash": encode_bytea(&token_hash) }),
        ));
    }
    match call.reply::<Option<RedeemRow>>(0) {
        Some(Ok(Some(row))) => match resolved(&row) {
            Ok(link) => RepoStep::done(&link),
            Err(e) => RepoStep::fail(e),
        },
        Some(Ok(None)) => RepoStep::unit(),
        Some(Err(e)) => RepoStep::fail(e),
        None => RepoStep::fail("reply 0 missing"),
    }
}

/// Decodes the wrapped key of a redeemed row.
fn resolved(row: &RedeemRow) -> Result<ResolvedShareLink, String> {
    let dek_wrap = row
        .dek_wrap
        .as_deref()
        .filter(|s| !s.is_empty())
        .map(decode_base64)
        .transpose()
        .map_err(ToOwned::to_owned)?;
    Ok(ResolvedShareLink {
        id: row.id.clone(),
        owner_id: row.owner_id.clone(),
        resource_type: row.resource_type,
        resource_id: row.resource_id.clone(),
        access: row.access,
        dek_wrap,
        dek_epoch: row.dek_epoch,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repo_query::{RepoAction, RepoSingle};
    use serde_json::Value;

    fn call(args: Vec<Value>, replies: Vec<Value>) -> RepoCall {
        RepoCall {
            args,
            replies,
            ..RepoCall::default()
        }
    }

    fn only(step: RepoStep) -> RepoQuery {
        match step {
            RepoStep::Send { mut queries } if queries.len() == 1 => queries.remove(0),
            other => panic!("expected one query, got {other:?}"),
        }
    }

    fn link_row() -> Value {
        json!({
            "id": "s1", "owner_id": "u1", "resource_type": "paper", "resource_id": "p1",
            "access": "view", "expires_at": null, "created_at": "2026-01-01T00:00:00.000Z"
        })
    }

    fn save_input() -> Value {
        json!({
            "id": "s1", "ownerId": "u1", "resourceType": "paper", "resourceId": "p1",
            "access": "view", "tokenHash": [10, 255], "expiresAt": null
        })
    }

    #[test]
    fn unknown_method_is_none() {
        assert!(step("nope", &call(vec![], vec![])).is_none());
    }

    #[test]
    fn get_by_id_selects_one_or_none() {
        let q = only(step("getById", &call(vec![json!("s1")], vec![])).unwrap());
        assert_eq!(q.table, "share_links");
        assert_eq!(q.columns.as_deref(), Some(SHARE_LINK_COLUMNS));
        assert_eq!(q.filters[0].column, "id");
        assert_eq!(q.single, RepoSingle::Maybe);
    }

    #[test]
    fn get_by_id_maps_row_or_null() {
        let s = step("getById", &call(vec![], vec![link_row()])).unwrap();
        let RepoStep::Done { value } = s else {
            panic!("{s:?}")
        };
        assert_eq!(value["ownerId"], "u1");
        assert_eq!(value["resourceType"], "paper");
        let none = step("getById", &call(vec![], vec![Value::Null])).unwrap();
        assert_eq!(none, RepoStep::Done { value: Value::Null });
    }

    #[test]
    fn get_by_id_fails_on_bad_row() {
        let s = step("getById", &call(vec![], vec![json!({"id": 1})])).unwrap();
        assert!(matches!(s, RepoStep::Fail { .. }));
    }

    #[test]
    fn list_for_resource_filters_newest_first() {
        let args = vec![json!("paper"), json!("p1")];
        let q = only(step("listForResource", &call(args, vec![])).unwrap());
        assert_eq!(q.filters[0].column, "resource_type");
        assert_eq!(q.filters[1].value, json!("p1"));
        assert!(!q.order[0].ascending);
    }

    #[test]
    fn list_for_resource_maps_rows() {
        let s = step("listForResource", &call(vec![], vec![json!([link_row()])])).unwrap();
        let RepoStep::Done { value } = s else {
            panic!("{s:?}")
        };
        assert_eq!(value[0]["id"], "s1");
        assert_eq!(value[0]["expiresAt"], Value::Null);
    }

    #[test]
    fn save_inserts_encoded_key_material_and_returns_link() {
        let q = only(step("save", &call(vec![save_input()], vec![])).unwrap());
        assert_eq!(q.action, RepoAction::Insert);
        assert_eq!(q.columns.as_deref(), Some(SHARE_LINK_COLUMNS));
        assert_eq!(q.single, RepoSingle::One);
        let body = q.body.unwrap();
        assert_eq!(body["token_hash"], "\\x0aff");
        assert_eq!(body["dek_wrap"], Value::Null);
        assert_eq!(body["dek_epoch"], Value::Null);
        assert_eq!(body["expires_at"], Value::Null);
        assert_eq!(body["resource_type"], "paper");
        let s = step("save", &call(vec![], vec![link_row()])).unwrap();
        let RepoStep::Done { value } = s else {
            panic!("{s:?}")
        };
        assert_eq!(value["id"], "s1");
        assert!(value.get("tokenHash").is_none());
    }

    #[test]
    fn save_encodes_wrapped_key_when_present() {
        let mut input = save_input();
        input["dekWrap"] = json!([1, 2]);
        input["dekEpoch"] = json!(3);
        let q = only(step("save", &call(vec![input], vec![])).unwrap());
        let body = q.body.unwrap();
        assert_eq!(body["dek_wrap"], "\\x0102");
        assert_eq!(body["dek_epoch"], 3);
    }

    #[test]
    fn save_rejects_bad_input() {
        let s = step("save", &call(vec![json!({"id": "s1"})], vec![])).unwrap();
        assert!(matches!(s, RepoStep::Fail { .. }));
    }

    #[test]
    fn delete_removes_by_id_then_finishes() {
        let q = only(step("delete", &call(vec![json!("s1")], vec![])).unwrap());
        assert_eq!(q.action, RepoAction::Delete);
        assert_eq!(q.filters[0].value, json!("s1"));
        assert_eq!(
            step("delete", &call(vec![], vec![Value::Null])),
            Some(RepoStep::unit())
        );
    }

    #[test]
    fn redeem_calls_rpc_with_encoded_hash() {
        let q = only(step("redeem", &call(vec![json!([10, 255])], vec![])).unwrap());
        assert_eq!(q.rpc.as_deref(), Some("redeem_share_link"));
        assert_eq!(q.body.unwrap()["p_token_hash"], "\\x0aff");
    }

    #[test]
    fn redeem_decodes_base64_wrap_and_maps_camel_case() {
        let reply = json!({
            "id": "s1", "ownerId": "u1", "resourceType": "paper", "resourceId": "p1",
            "access": "view", "dekWrap": "AQI=", "dekEpoch": 2
        });
        let s = step("redeem", &call(vec![], vec![reply])).unwrap();
        let RepoStep::Done { value } = s else {
            panic!("{s:?}")
        };
        assert_eq!(value["dekWrap"], json!([1, 2]));
        assert_eq!(value["dekEpoch"], 2);
        assert_eq!(value["ownerId"], "u1");
    }

    #[test]
    fn redeem_empty_wrap_is_null_and_missing_row_is_null() {
        let reply = json!({
            "id": "s1", "ownerId": "u1", "resourceType": "paper", "resourceId": "p1",
            "access": "view", "dekWrap": "", "dekEpoch": null
        });
        let s = step("redeem", &call(vec![], vec![reply])).unwrap();
        let RepoStep::Done { value } = s else {
            panic!("{s:?}")
        };
        assert_eq!(value["dekWrap"], Value::Null);
        let none = step("redeem", &call(vec![], vec![Value::Null])).unwrap();
        assert_eq!(none, RepoStep::Done { value: Value::Null });
    }

    #[test]
    fn redeem_fails_on_bad_base64() {
        let reply = json!({
            "id": "s1", "ownerId": "u1", "resourceType": "paper", "resourceId": "p1",
            "access": "view", "dekWrap": "A", "dekEpoch": null
        });
        let s = step("redeem", &call(vec![], vec![reply])).unwrap();
        assert_eq!(s, RepoStep::fail("invalid base64 length"));
    }
}
