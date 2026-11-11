//! The `library_pins` repository as Rust-planned queries.
//!
//! Ported from `apps/web/src/features/library/infrastructure/postgrest-library-pin-repository.ts`.
//! Rows are read and mapped by [`crate::library_pin_rows`], the same mapping the WASM backend uses.

use serde::Deserialize;
use serde_json::json;

use crate::library_pin_rows::to_domain;
use crate::repo_query::{RepoCall, RepoQuery, RepoStep, map_row, map_rows};
use crate::sharing::ShareableType;

const TABLE: &str = "library_pins";

/// The columns a [`crate::library_pin_rows::PinRow`] is read as, named rather than starred.
const PIN_COLUMNS: &str = "id,user_id,project_id,resource_type,resource_id,owner_id,created_at";

/// Upsert conflict target: one pin per user, project and resource.
const ON_CONFLICT: &str = "user_id,project_id,resource_type,resource_id";

/// Completes "Select a project before …" for project-scoped writes.
const ACTION: &str = "pinning items";

/// `NewLibraryPinInput` as the TS caller hands it over.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PinInput {
    resource_type: ShareableType,
    resource_id: String,
    owner_id: String,
}

/// The next step of `method`, or `None` for an unknown method.
#[must_use]
pub fn step(method: &str, call: &RepoCall) -> Option<RepoStep> {
    Some(match method {
        "pin" => pin(call),
        "unpin" => unpin(call),
        "listForProject" => list_for_project(call),
        "isPinned" => is_pinned(call),
        _ => return None,
    })
}

/// `pin(input)`: upserts the pin for the signed-in user and returns it.
fn pin(call: &RepoCall) -> RepoStep {
    if call.replies.is_empty() {
        let user = match call.user() {
            Ok(u) => u,
            Err(s) => return s,
        };
        let project = match call.project(ACTION) {
            Ok(p) => p,
            Err(s) => return s,
        };
        let input: PinInput = match call.parse(0) {
            Ok(input) => input,
            Err(e) => return RepoStep::fail(e),
        };
        return RepoStep::send(
            RepoQuery::upsert(
                TABLE,
                json!({
                    "user_id": user,
                    "project_id": project,
                    "resource_type": input.resource_type,
                    "resource_id": input.resource_id,
                    "owner_id": input.owner_id,
                }),
            )
            .on_conflict(ON_CONFLICT, false)
            .returning(PIN_COLUMNS)
            .single(),
        );
    }
    map_row(call, 0, to_domain)
}

/// `unpin(resourceType, resourceId)`: removes the pin in the selected project.
fn unpin(call: &RepoCall) -> RepoStep {
    if call.replies.is_empty() {
        let project = match call.project(ACTION) {
            Ok(p) => p,
            Err(s) => return s,
        };
        return RepoStep::send(
            RepoQuery::delete(TABLE)
                .eq("project_id", project)
                .eq("resource_type", call.text(0))
                .eq("resource_id", call.text(1)),
        );
    }
    RepoStep::unit()
}

/// `listForProject()`: the selected project's pins, newest first; none without a project.
fn list_for_project(call: &RepoCall) -> RepoStep {
    if !call.replies.is_empty() {
        return map_rows(call, 0, to_domain);
    }
    let Some(project) = call.ctx.project_id.as_deref().filter(|p| !p.is_empty()) else {
        return RepoStep::Done { value: json!([]) };
    };
    RepoStep::send(
        RepoQuery::select(TABLE, PIN_COLUMNS)
            .eq("project_id", project)
            .order("created_at", false),
    )
}

/// `isPinned(resourceType, resourceId)`: whether a matching pin exists; false without a project.
fn is_pinned(call: &RepoCall) -> RepoStep {
    if !call.replies.is_empty() {
        return match call.reply::<Option<i64>>(0) {
            Some(Ok(count)) => RepoStep::done(&(count.unwrap_or(0) > 0)),
            Some(Err(e)) => RepoStep::fail(e),
            None => RepoStep::fail("reply 0 missing"),
        };
    }
    let Some(project) = call.ctx.project_id.as_deref().filter(|p| !p.is_empty()) else {
        return RepoStep::Done {
            value: json!(false),
        };
    };
    RepoStep::send(
        RepoQuery::count(TABLE)
            .eq("project_id", project)
            .eq("resource_type", call.text(0))
            .eq("resource_id", call.text(1)),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repo_query::{RepoAction, RepoCtx, RepoSingle};
    use serde_json::Value;

    fn call(args: Vec<Value>, replies: Vec<Value>, project: bool, user: bool) -> RepoCall {
        RepoCall {
            args,
            replies,
            ctx: RepoCtx {
                project_id: project.then(|| "j1".to_owned()),
                user_id: user.then(|| "u1".to_owned()),
                now: None,
            },
        }
    }

    fn both(args: Vec<Value>, replies: Vec<Value>) -> RepoCall {
        call(args, replies, true, true)
    }

    fn only(step: RepoStep) -> RepoQuery {
        match step {
            RepoStep::Send { mut queries } if queries.len() == 1 => queries.remove(0),
            other => panic!("expected one query, got {other:?}"),
        }
    }

    fn row() -> Value {
        json!({
            "id": "p1", "user_id": "u1", "project_id": "j1", "resource_type": "report_section",
            "resource_id": "r1", "owner_id": "o1", "created_at": "2026-11-01T00:00:00Z"
        })
    }

    fn input() -> Value {
        json!({"resourceType": "report_section", "resourceId": "r1", "ownerId": "o1"})
    }

    #[test]
    fn pin_upserts_on_conflict_for_signed_in_user() {
        let q = only(step("pin", &both(vec![input()], vec![])).unwrap());
        assert_eq!(q.table, "library_pins");
        assert_eq!(q.action, RepoAction::Upsert);
        assert_eq!(q.on_conflict.as_deref(), Some(ON_CONFLICT));
        assert!(!q.ignore_duplicates);
        assert_eq!(q.single, RepoSingle::One);
        assert_eq!(q.columns.as_deref(), Some(PIN_COLUMNS));
        let body = q.body.unwrap();
        assert_eq!(body["user_id"], "u1");
        assert_eq!(body["project_id"], "j1");
        assert_eq!(body["resource_type"], "report_section");
        assert_eq!(body["owner_id"], "o1");
    }

    #[test]
    fn pin_maps_returned_row() {
        let s = step("pin", &both(vec![], vec![row()])).unwrap();
        let RepoStep::Done { value } = s else {
            panic!("{s:?}")
        };
        assert_eq!(value["projectId"], "j1");
        assert_eq!(value["resourceType"], "report_section");
    }

    #[test]
    fn pin_fails_without_user_or_project() {
        let s = step("pin", &call(vec![input()], vec![], true, false)).unwrap();
        assert_eq!(s, RepoStep::fail("Not signed in."));
        let s = step("pin", &call(vec![input()], vec![], false, true)).unwrap();
        assert_eq!(s, RepoStep::fail("Select a project before pinning items."));
    }

    #[test]
    fn pin_rejects_bad_input() {
        let s = step("pin", &both(vec![json!({"resourceId": "r1"})], vec![])).unwrap();
        assert!(matches!(s, RepoStep::Fail { .. }));
    }

    #[test]
    fn unpin_deletes_matching_pin_in_project() {
        let q = only(
            step(
                "unpin",
                &both(vec![json!("report_section"), json!("r1")], vec![]),
            )
            .unwrap(),
        );
        assert_eq!(q.action, RepoAction::Delete);
        assert_eq!(q.filters[0].column, "project_id");
        assert_eq!(q.filters[0].value, json!("j1"));
        assert_eq!(q.filters[1].column, "resource_type");
        assert_eq!(q.filters[2].value, json!("r1"));
    }

    #[test]
    fn unpin_finishes_after_reply() {
        let s = step("unpin", &both(vec![], vec![Value::Null])).unwrap();
        assert_eq!(s, RepoStep::unit());
    }

    #[test]
    fn unpin_fails_without_project() {
        let s = step("unpin", &call(vec![], vec![], false, true)).unwrap();
        assert_eq!(s, RepoStep::fail("Select a project before pinning items."));
    }

    #[test]
    fn list_for_project_selects_newest_first() {
        let q = only(step("listForProject", &both(vec![], vec![])).unwrap());
        assert_eq!(q.table, "library_pins");
        assert_eq!(q.columns.as_deref(), Some(PIN_COLUMNS));
        assert_eq!(q.filters[0].column, "project_id");
        assert_eq!(q.filters[0].value, json!("j1"));
        assert_eq!(q.order[0].column, "created_at");
        assert!(!q.order[0].ascending);
    }

    #[test]
    fn list_for_project_is_empty_without_project() {
        let s = step("listForProject", &call(vec![], vec![], false, true)).unwrap();
        assert_eq!(s, RepoStep::Done { value: json!([]) });
    }

    #[test]
    fn list_for_project_maps_rows() {
        let s = step("listForProject", &both(vec![], vec![json!([row()])])).unwrap();
        let RepoStep::Done { value } = s else {
            panic!("{s:?}")
        };
        assert_eq!(value[0]["id"], "p1");
        assert_eq!(value[0]["ownerId"], "o1");
    }

    #[test]
    fn list_for_project_fails_on_bad_row() {
        let s = step("listForProject", &both(vec![], vec![json!([{"id": 1}])])).unwrap();
        assert!(matches!(s, RepoStep::Fail { .. }));
    }

    #[test]
    fn is_pinned_counts_matching_pins() {
        let q = only(
            step(
                "isPinned",
                &both(vec![json!("report_section"), json!("r1")], vec![]),
            )
            .unwrap(),
        );
        assert!(q.count);
        assert_eq!(q.action, RepoAction::Select);
        assert_eq!(q.columns.as_deref(), Some("id"));
        assert_eq!(q.filters.len(), 3);
        assert_eq!(q.filters[2].value, json!("r1"));
    }

    #[test]
    fn is_pinned_true_when_count_positive() {
        let s = step("isPinned", &both(vec![], vec![json!(2)])).unwrap();
        assert_eq!(s, RepoStep::Done { value: json!(true) });
    }

    #[test]
    fn is_pinned_false_when_count_zero_or_null() {
        let s = step("isPinned", &both(vec![], vec![json!(0)])).unwrap();
        assert_eq!(
            s,
            RepoStep::Done {
                value: json!(false)
            }
        );
        let s = step("isPinned", &both(vec![], vec![Value::Null])).unwrap();
        assert_eq!(
            s,
            RepoStep::Done {
                value: json!(false)
            }
        );
    }

    #[test]
    fn is_pinned_false_without_project() {
        let s = step("isPinned", &call(vec![], vec![], false, true)).unwrap();
        assert_eq!(
            s,
            RepoStep::Done {
                value: json!(false)
            }
        );
    }

    #[test]
    fn unknown_method_is_none() {
        assert!(step("nope", &both(vec![], vec![])).is_none());
    }
}
