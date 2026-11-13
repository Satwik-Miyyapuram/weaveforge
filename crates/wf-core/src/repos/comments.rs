//! The `comments` repository (migration 0018) as Rust-planned queries.
//!
//! Ported from `apps/web/src/features/sharing/infrastructure/postgrest-comment-repository.ts`.
//! `author_id` defaults to `auth.uid()` server-side; RLS gates who may read
//! (`can_view_resource`) and add (`can_comment_resource`).

use serde_json::{Value, json};

use crate::repo_query::{RepoCall, RepoQuery, RepoStep, map_row, map_rows};
use crate::sharing::{NewCommentInput, comment_from_row};

const TABLE: &str = "comments";

/// The columns a [`crate::sharing::CommentRow`] is read as, named rather than starred.
pub const COMMENT_COLUMNS: &str = "id,author_id,resource_type,resource_id,body,created_at,anchor_quote,anchor_prefix,anchor_suffix,parent_id,resolved_at";

/// The next step of `method`, or `None` for an unknown method.
#[must_use]
pub fn step(method: &str, call: &RepoCall) -> Option<RepoStep> {
    Some(match method {
        "list" => list(call),
        "add" => add(call),
        "remove" => remove(call),
        "setResolved" => set_resolved(call),
        _ => return None,
    })
}

/// `list(resourceType, resourceId)`: oldest first.
fn list(call: &RepoCall) -> RepoStep {
    if call.replies.is_empty() {
        return RepoStep::send(
            RepoQuery::select(TABLE, COMMENT_COLUMNS)
                .eq("resource_type", call.text(0))
                .eq("resource_id", call.text(1))
                .order("created_at", true),
        );
    }
    map_rows(call, 0, comment_from_row)
}

/// `add(input)`: the stored comment.
fn add(call: &RepoCall) -> RepoStep {
    if call.replies.is_empty() {
        let input: NewCommentInput = match call.parse(0) {
            Ok(input) => input,
            Err(e) => return RepoStep::fail(e),
        };
        let anchor = input.anchor.as_ref();
        return RepoStep::send(
            RepoQuery::insert(
                TABLE,
                json!({
                    "resource_type": input.resource_type,
                    "resource_id": input.resource_id,
                    "body": input.body,
                    "anchor_quote": anchor.map(|a| &a.quote),
                    "anchor_prefix": anchor.map(|a| &a.prefix),
                    "anchor_suffix": anchor.map(|a| &a.suffix),
                    "parent_id": input.parent_id,
                }),
            )
            .returning(COMMENT_COLUMNS)
            .single(),
        );
    }
    map_row(call, 0, comment_from_row)
}

/// `remove(id)`.
fn remove(call: &RepoCall) -> RepoStep {
    if call.replies.is_empty() {
        return RepoStep::send(RepoQuery::delete(TABLE).eq("id", call.text(0)));
    }
    RepoStep::unit()
}

/// `setResolved(id, resolved)`: the new `resolved_at`, or `null`.
///
/// Through `set_comment_resolved` (0133), not an update: the page owner may resolve someone
/// else's thread, and an UPDATE policy that allowed that would also let them rewrite its body.
fn set_resolved(call: &RepoCall) -> RepoStep {
    if call.replies.is_empty() {
        return RepoStep::send(RepoQuery::rpc(
            "set_comment_resolved",
            json!({ "p_comment_id": call.text(0), "p_resolved": call.arg(1).as_bool().unwrap_or(false) }),
        ));
    }
    let value = call.replies[0]
        .as_str()
        .map_or(Value::Null, |s| Value::String(s.into()));
    RepoStep::Done { value }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repo_query::{RepoAction, RepoSingle};

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

    fn row() -> Value {
        json!({
            "id": "c1", "author_id": "u1", "resource_type": "note", "resource_id": "n1",
            "body": "hi", "created_at": "2026-01-01T00:00:00.000Z",
            "anchor_quote": "q", "anchor_prefix": "p", "anchor_suffix": "s",
            "parent_id": null, "resolved_at": null
        })
    }

    #[test]
    fn list_filters_by_resource_oldest_first() {
        let q = only(step("list", &call(vec![json!("note"), json!("n1")], vec![])).unwrap());
        assert_eq!(q.table, "comments");
        assert_eq!(q.columns.as_deref(), Some(COMMENT_COLUMNS));
        assert_eq!(q.filters[0].column, "resource_type");
        assert_eq!(q.filters[1].value, json!("n1"));
        assert!(q.order[0].ascending);
    }

    #[test]
    fn list_maps_rows() {
        let s = step("list", &call(vec![], vec![json!([row()])])).unwrap();
        let RepoStep::Done { value } = s else {
            panic!("{s:?}")
        };
        assert_eq!(value[0]["id"], "c1");
        assert_eq!(value[0]["anchor"]["quote"], "q");
    }

    #[test]
    fn list_fails_on_bad_row() {
        let s = step("list", &call(vec![], vec![json!([{"id": 1}])])).unwrap();
        assert!(matches!(s, RepoStep::Fail { .. }));
    }

    #[test]
    fn add_inserts_nulls_for_missing_anchor() {
        let input = json!({"resourceType": "note", "resourceId": "n1", "body": "b"});
        let q = only(step("add", &call(vec![input], vec![])).unwrap());
        assert_eq!(q.action, RepoAction::Insert);
        assert_eq!(q.single, RepoSingle::One);
        let body = q.body.unwrap();
        assert_eq!(body["anchor_quote"], Value::Null);
        assert_eq!(body["parent_id"], Value::Null);
        assert_eq!(body["body"], "b");
    }

    #[test]
    fn add_rejects_bad_input() {
        let s = step("add", &call(vec![json!({"body": 1})], vec![])).unwrap();
        assert!(matches!(s, RepoStep::Fail { .. }));
    }

    #[test]
    fn add_maps_returned_row() {
        let s = step("add", &call(vec![], vec![row()])).unwrap();
        let RepoStep::Done { value } = s else {
            panic!("{s:?}")
        };
        assert_eq!(value["authorId"], "u1");
    }

    #[test]
    fn remove_deletes_by_id_then_finishes() {
        let q = only(step("remove", &call(vec![json!("c1")], vec![])).unwrap());
        assert_eq!(q.action, RepoAction::Delete);
        assert_eq!(q.filters[0].value, json!("c1"));
        assert_eq!(
            step("remove", &call(vec![], vec![Value::Null])),
            Some(RepoStep::unit())
        );
    }

    #[test]
    fn set_resolved_calls_rpc_and_returns_text_or_null() {
        let q = only(step("setResolved", &call(vec![json!("c1"), json!(true)], vec![])).unwrap());
        assert_eq!(q.rpc.as_deref(), Some("set_comment_resolved"));
        assert_eq!(q.body.unwrap()["p_resolved"], true);
        let done = step("setResolved", &call(vec![], vec![json!("2026")])).unwrap();
        assert_eq!(
            done,
            RepoStep::Done {
                value: json!("2026")
            }
        );
        let none = step("setResolved", &call(vec![], vec![Value::Null])).unwrap();
        assert_eq!(none, RepoStep::Done { value: Value::Null });
    }
}
