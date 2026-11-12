//! The `shares` repository (migration 0018) as Rust-planned queries.
//!
//! Ported from `apps/web/src/features/sharing/infrastructure/postgrest-share-repository.ts`.
//! `owner_id` defaults to `auth.uid()` server-side; RLS scopes changes to the caller's own rows
//! (`shares_owner_all`).

use serde_json::{Value, json};

use crate::repo_query::{RepoCall, RepoQuery, RepoStep, map_row, map_rows};
use crate::sharing::{NewShareInput, ShareAccess, ShareRow, ShareableType, share_from_row};

const TABLE: &str = "shares";

/// The columns a [`ShareRow`] is read as, named rather than starred.
pub const SHARE_COLUMNS: &str =
    "id,owner_id,recipient_id,resource_type,resource_id,access,created_at";

/// The next step of `method`, or `None` for an unknown method.
#[must_use]
pub fn step(method: &str, call: &RepoCall) -> Option<RepoStep> {
    Some(match method {
        "grant" => grant(call),
        "revoke" => revoke(call),
        "listForResource" => list_for_resource(call),
        "listSharedWithMe" => list_shared_with_me(call),
        _ => return None,
    })
}

/// Postgres: a row with the same unique key already exists.
const UNIQUE_VIOLATION: &str = "23505";

/// `grant(input)`: changes the caller's existing share in place, inserts only when there is none.
///
/// A concurrent grant that inserts first (23505) is changed instead, as the TS does.
fn grant(call: &RepoCall) -> RepoStep {
    let input: NewShareInput = match call.parse(0) {
        Ok(input) => input,
        Err(e) => return RepoStep::fail(e),
    };
    let access = input.access.unwrap_or(ShareAccess::Comment);
    match call.replies.len() {
        0 => RepoStep::send(change_access(&input, access)),
        1 => match call.reply::<Option<ShareRow>>(0) {
            Some(Ok(Some(row))) => RepoStep::done(&share_from_row(&row)),
            Some(Ok(None)) => RepoStep::send(insert_share(&input, access)),
            Some(Err(e)) => RepoStep::fail(e),
            None => RepoStep::fail("reply 0 missing"),
        },
        2 => match call.reply_error_code(1) {
            Some(UNIQUE_VIOLATION) => RepoStep::send(change_access(&input, access)),
            _ if call.replies[1].get("error").is_some() => RepoStep::fail(error_message(call, 1)),
            _ => map_row(call, 1, share_from_row),
        },
        _ => match call.reply::<Option<ShareRow>>(2) {
            Some(Ok(Some(row))) => RepoStep::done(&share_from_row(&row)),
            Some(Ok(None)) => RepoStep::fail(error_message(call, 1)),
            Some(Err(e)) => RepoStep::fail(e),
            None => RepoStep::fail("reply 2 missing"),
        },
    }
}

/// The message of the soft error in reply `i`, or empty.
fn error_message(call: &RepoCall, i: usize) -> String {
    call.replies
        .get(i)
        .and_then(|r| r.get("error"))
        .and_then(|e| e.get("message"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_owned()
}

/// The update of the caller's share for this recipient, type and item.
fn change_access(input: &NewShareInput, access: ShareAccess) -> RepoQuery {
    scope(RepoQuery::update(TABLE, json!({ "access": access })), input)
        .returning(SHARE_COLUMNS)
        .maybe_single()
}

/// The insert of a new share for this recipient, type and item.
fn insert_share(input: &NewShareInput, access: ShareAccess) -> RepoQuery {
    RepoQuery::insert(
        TABLE,
        json!({
            "recipient_id": input.recipient_id,
            "resource_type": input.resource_type,
            "resource_id": input.resource_id,
            "access": access,
        }),
    )
    .returning(SHARE_COLUMNS)
    .single()
    .soft()
}

/// Filters `q` to the grant's recipient, type and item.
fn scope(q: RepoQuery, input: &NewShareInput) -> RepoQuery {
    let q = q
        .eq("recipient_id", input.recipient_id.as_str())
        .eq("resource_type", json!(input.resource_type));
    on_resource(q, input.resource_id.as_deref())
}

/// Filters `q` to one item, or to the blanket share (`resource_id` is null) when `None`.
fn on_resource(q: RepoQuery, resource_id: Option<&str>) -> RepoQuery {
    match resource_id {
        Some(id) => q.eq("resource_id", id),
        None => q.filter("is", "resource_id", Value::Null),
    }
}

/// `revoke(id)`.
fn revoke(call: &RepoCall) -> RepoStep {
    if call.replies.is_empty() {
        return RepoStep::send(RepoQuery::delete(TABLE).eq("id", call.text(0)));
    }
    RepoStep::unit()
}

/// `listForResource(resourceType, resourceId)`: the shares of one item, or of the blanket type.
fn list_for_resource(call: &RepoCall) -> RepoStep {
    if call.replies.is_empty() {
        let resource_type: ShareableType = match call.parse(0) {
            Ok(resource_type) => resource_type,
            Err(e) => return RepoStep::fail(e),
        };
        return RepoStep::send(on_resource(
            RepoQuery::select(TABLE, SHARE_COLUMNS).eq("resource_type", json!(resource_type)),
            call.arg(1).as_str(),
        ));
    }
    map_rows(call, 0, share_from_row)
}

/// `listSharedWithMe(resourceType?)`: newest first; empty when no one is signed in.
fn list_shared_with_me(call: &RepoCall) -> RepoStep {
    if call.replies.is_empty() {
        let Some(uid) = call.ctx.user_id.as_deref().filter(|id| !id.is_empty()) else {
            return RepoStep::Done { value: json!([]) };
        };
        let mut q = RepoQuery::select(TABLE, SHARE_COLUMNS).eq("recipient_id", uid);
        // TS `if (resourceType)`: an empty string is no filter.
        if !call.arg(0).is_null() && call.arg(0).as_str() != Some("") {
            let resource_type: ShareableType = match call.parse(0) {
                Ok(resource_type) => resource_type,
                Err(e) => return RepoStep::fail(e),
            };
            q = q.eq("resource_type", json!(resource_type));
        }
        return RepoStep::send(q.order("created_at", false));
    }
    map_rows(call, 0, share_from_row)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repo_query::{RepoAction, RepoCtx, RepoSingle};

    fn call(args: Vec<Value>, replies: Vec<Value>) -> RepoCall {
        RepoCall {
            args,
            replies,
            ..RepoCall::default()
        }
    }

    fn signed_in(args: Vec<Value>, replies: Vec<Value>) -> RepoCall {
        RepoCall {
            ctx: RepoCtx {
                project_id: None,
                user_id: Some("u1".into()),
                now: None,
                id_seed: None,
            },
            ..call(args, replies)
        }
    }

    fn only(step: RepoStep) -> RepoQuery {
        match step {
            RepoStep::Send { mut queries } if queries.len() == 1 => queries.remove(0),
            other => panic!("expected one query, got {other:?}"),
        }
    }

    fn row() -> Value {
        json!({
            "id": "s1", "owner_id": "u1", "recipient_id": "u2", "resource_type": "paper",
            "resource_id": "p1", "access": "view", "created_at": "2026-01-01T00:00:00.000Z"
        })
    }

    fn grant_input() -> Value {
        json!({"recipientId": "u2", "resourceType": "paper", "resourceId": "p1", "access": "view"})
    }

    #[test]
    fn grant_updates_the_existing_share_first() {
        let q = only(step("grant", &call(vec![grant_input()], vec![])).unwrap());
        assert_eq!(q.table, "shares");
        assert_eq!(q.action, RepoAction::Update);
        assert_eq!(q.single, RepoSingle::Maybe);
        assert_eq!(q.columns.as_deref(), Some(SHARE_COLUMNS));
        assert_eq!(q.body, Some(json!({"access": "view"})));
        assert_eq!(q.filters[0].value, json!("u2"));
        assert_eq!(q.filters[1].value, json!("paper"));
        assert_eq!(q.filters[2].value, json!("p1"));
    }

    #[test]
    fn grant_returns_the_updated_share() {
        let s = step("grant", &call(vec![grant_input()], vec![row()])).unwrap();
        let RepoStep::Done { value } = s else {
            panic!("{s:?}")
        };
        assert_eq!(value["ownerId"], "u1");
        assert_eq!(value["access"], "view");
    }

    #[test]
    fn grant_inserts_when_there_is_no_share_with_default_access() {
        let input = json!({"recipientId": "u2", "resourceType": "paper", "resourceId": null});
        let q = only(step("grant", &call(vec![input], vec![Value::Null])).unwrap());
        assert_eq!(q.action, RepoAction::Insert);
        assert_eq!(q.single, RepoSingle::One);
        let body = q.body.unwrap();
        assert_eq!(body["access"], "comment");
        assert_eq!(body["resource_id"], Value::Null);
        assert_eq!(body["recipient_id"], "u2");
    }

    #[test]
    fn grant_returns_the_inserted_share() {
        let s = step(
            "grant",
            &call(vec![grant_input()], vec![Value::Null, row()]),
        )
        .unwrap();
        let RepoStep::Done { value } = s else {
            panic!("{s:?}")
        };
        assert_eq!(value["recipientId"], "u2");
    }

    fn soft_error(code: &str, message: &str) -> Value {
        json!({"error": {"code": code, "message": message}})
    }

    #[test]
    fn grant_inserts_softly_so_a_unique_violation_is_a_reply() {
        let q = only(step("grant", &call(vec![grant_input()], vec![Value::Null])).unwrap());
        assert_eq!(q.action, RepoAction::Insert);
        assert!(q.soft);
    }

    #[test]
    fn grant_retries_the_change_on_unique_violation() {
        let s = step(
            "grant",
            &call(
                vec![grant_input()],
                vec![Value::Null, soft_error("23505", "dup")],
            ),
        )
        .unwrap();
        let q = only(s);
        assert_eq!(q.action, RepoAction::Update);
        assert_eq!(q.single, RepoSingle::Maybe);
        assert_eq!(q.body, Some(json!({"access": "view"})));
        assert_eq!(q.filters[2].value, json!("p1"));
    }

    #[test]
    fn grant_returns_the_share_changed_by_the_retry() {
        let s = step(
            "grant",
            &call(
                vec![grant_input()],
                vec![Value::Null, soft_error("23505", "dup"), row()],
            ),
        )
        .unwrap();
        let RepoStep::Done { value } = s else {
            panic!("{s:?}")
        };
        assert_eq!(value["ownerId"], "u1");
    }

    #[test]
    fn grant_fails_with_the_insert_error_when_the_retry_finds_no_share() {
        let s = step(
            "grant",
            &call(
                vec![grant_input()],
                vec![Value::Null, soft_error("23505", "dup"), Value::Null],
            ),
        )
        .unwrap();
        assert_eq!(s, RepoStep::fail("dup"));
    }

    #[test]
    fn grant_fails_with_the_message_of_any_other_error_code() {
        let s = step(
            "grant",
            &call(
                vec![grant_input()],
                vec![Value::Null, soft_error("42501", "denied")],
            ),
        )
        .unwrap();
        assert_eq!(s, RepoStep::fail("denied"));
    }

    #[test]
    fn grant_fails_on_bad_input_or_bad_reply() {
        let bad = step("grant", &call(vec![json!({"recipientId": 1})], vec![])).unwrap();
        assert!(matches!(bad, RepoStep::Fail { .. }));
        let reply = step("grant", &call(vec![grant_input()], vec![json!(5)])).unwrap();
        assert!(matches!(reply, RepoStep::Fail { .. }));
    }

    #[test]
    fn revoke_deletes_by_id_then_finishes() {
        let q = only(step("revoke", &call(vec![json!("s1")], vec![])).unwrap());
        assert_eq!(q.action, RepoAction::Delete);
        assert_eq!(q.filters[0].value, json!("s1"));
        assert_eq!(
            step("revoke", &call(vec![], vec![Value::Null])),
            Some(RepoStep::unit())
        );
    }

    #[test]
    fn list_for_resource_filters_by_item_and_maps_rows() {
        let q = only(
            step(
                "listForResource",
                &call(vec![json!("paper"), json!("p1")], vec![]),
            )
            .unwrap(),
        );
        assert_eq!(q.action, RepoAction::Select);
        assert_eq!(q.filters[0].value, json!("paper"));
        assert_eq!(q.filters[1].op, "eq");
        assert_eq!(q.filters[1].value, json!("p1"));
        let s = step("listForResource", &call(vec![], vec![json!([row()])])).unwrap();
        let RepoStep::Done { value } = s else {
            panic!("{s:?}")
        };
        assert_eq!(value[0]["id"], "s1");
        assert_eq!(value[0]["resourceId"], "p1");
    }

    #[test]
    fn list_for_resource_matches_blanket_shares_with_is_null() {
        let q = only(
            step(
                "listForResource",
                &call(vec![json!("paper"), Value::Null], vec![]),
            )
            .unwrap(),
        );
        assert_eq!(q.filters[1].op, "is");
        assert_eq!(q.filters[1].value, Value::Null);
    }

    #[test]
    fn list_for_resource_rejects_bad_type() {
        let s = step(
            "listForResource",
            &call(vec![json!("nope"), json!("p1")], vec![]),
        )
        .unwrap();
        assert!(matches!(s, RepoStep::Fail { .. }));
    }

    #[test]
    fn list_shared_with_me_is_empty_when_signed_out() {
        assert_eq!(
            step("listSharedWithMe", &call(vec![], vec![])),
            Some(RepoStep::Done { value: json!([]) })
        );
    }

    #[test]
    fn list_shared_with_me_queries_newest_first() {
        let q = only(step("listSharedWithMe", &signed_in(vec![], vec![])).unwrap());
        assert_eq!(q.filters[0].value, json!("u1"));
        assert_eq!(q.filters.len(), 1);
        assert!(!q.order[0].ascending);
    }

    #[test]
    fn list_shared_with_me_filters_by_type_when_given() {
        let q = only(step("listSharedWithMe", &signed_in(vec![json!("paper")], vec![])).unwrap());
        assert_eq!(q.filters[1].value, json!("paper"));
    }

    #[test]
    fn list_shared_with_me_treats_empty_type_as_no_filter() {
        let q = only(step("listSharedWithMe", &signed_in(vec![json!("")], vec![])).unwrap());
        assert_eq!(q.filters.len(), 1);
    }

    #[test]
    fn grant_fails_with_the_message_of_an_error_without_code() {
        let error = json!({"error": {"code": null, "message": "offline"}});
        let s = step(
            "grant",
            &call(vec![grant_input()], vec![Value::Null, error]),
        )
        .unwrap();
        assert_eq!(s, RepoStep::fail("offline"));
    }

    #[test]
    fn list_shared_with_me_maps_rows() {
        let s = step("listSharedWithMe", &signed_in(vec![], vec![json!([row()])])).unwrap();
        let RepoStep::Done { value } = s else {
            panic!("{s:?}")
        };
        assert_eq!(value[0]["recipientId"], "u2");
    }

    #[test]
    fn unknown_method_is_none() {
        assert!(step("nope", &call(vec![], vec![])).is_none());
    }
}
