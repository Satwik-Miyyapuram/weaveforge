//! The signed-in user's lab memberships and the org RPCs, as Rust-planned queries.
//!
//! Ported from the anon-key half of `apps/web/src/features/org/infrastructure/parts.ts`
//! (`fetchMemberships`, `switchOrg`, `leaveOrg`, `continueStandalone`). The service-role
//! relay fallbacks stay in TS: they are HTTP calls, not queries.

use serde_json::json;

use crate::membership_row::to_view;
use crate::repo_query::{RepoCall, RepoQuery, RepoStep, map_rows};

/// The `org_memberships` columns a [`crate::membership_row::MembershipRow`] is read as.
pub const MEMBERSHIP_ROW_COLUMNS: &str = "org_id, role, joined_via, organizations(name)";

/// The next step of `method`, or `None` for an unknown method.
#[must_use]
pub fn step(method: &str, call: &RepoCall) -> Option<RepoStep> {
    Some(match method {
        "memberships" => memberships(call),
        "switchActive" => rpc(call, "switch_active_org", true),
        "leave" => rpc(call, "leave_org", true),
        "completeSetup" => rpc(call, "complete_org_setup", false),
        _ => return None,
    })
}

/// `memberships()`: the caller's labs, oldest join first.
fn memberships(call: &RepoCall) -> RepoStep {
    if !call.replies.is_empty() {
        return map_rows(call, 0, to_view);
    }
    match call.user() {
        Ok(uid) => RepoStep::send(
            RepoQuery::select("org_memberships", MEMBERSHIP_ROW_COLUMNS)
                .eq("user_id", uid)
                .order("joined_at", true),
        ),
        Err(step) => step,
    }
}

/// Call `name`, with `p_org_id` from the first argument when `with_org`.
fn rpc(call: &RepoCall, name: &str, with_org: bool) -> RepoStep {
    if !call.replies.is_empty() {
        return RepoStep::unit();
    }
    let args = if with_org {
        json!({ "p_org_id": call.text(0) })
    } else {
        json!({})
    };
    RepoStep::send(RepoQuery::rpc(name, args))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repo_query::RepoCtx;
    use serde_json::{Value, json};

    fn call(args: Vec<Value>, replies: Vec<Value>) -> RepoCall {
        RepoCall {
            args,
            replies,
            ctx: RepoCtx {
                user_id: Some("u1".into()),
                ..RepoCtx::default()
            },
        }
    }

    fn sent(step: RepoStep) -> RepoQuery {
        match step {
            RepoStep::Send { mut queries } => queries.remove(0),
            other => panic!("expected send, got {other:?}"),
        }
    }

    fn done(step: RepoStep) -> Value {
        match step {
            RepoStep::Done { value } => value,
            other => panic!("expected done, got {other:?}"),
        }
    }

    #[test]
    fn memberships_read_the_callers_rows_oldest_first() {
        let q = sent(memberships(&call(vec![], vec![])));
        assert_eq!(q.filters[0].value, json!("u1"));
        assert_eq!(q.order[0].column, "joined_at");
        assert!(q.order[0].ascending);
        let rows = json!([{ "org_id": "o1", "role": "phd", "joined_via": "invite",
            "organizations": { "name": "Lab A" } }]);
        let v = done(memberships(&call(vec![], vec![rows])));
        assert_eq!(v[0]["orgName"], "Lab A");
        assert_eq!(v[0]["joinSource"], "invite");
    }

    #[test]
    fn memberships_need_a_user() {
        let mut c = call(vec![], vec![]);
        c.ctx.user_id = None;
        assert!(matches!(memberships(&c), RepoStep::Fail { .. }));
    }

    #[test]
    fn org_rpcs_send_the_org_id() {
        let q = sent(step("switchActive", &call(vec![json!("o2")], vec![])).unwrap());
        assert_eq!(q.rpc.as_deref(), Some("switch_active_org"));
        assert_eq!(q.body, Some(json!({ "p_org_id": "o2" })));
        let q = sent(step("leave", &call(vec![json!("o2")], vec![])).unwrap());
        assert_eq!(q.rpc.as_deref(), Some("leave_org"));
        let done_step = step("leave", &call(vec![json!("o2")], vec![Value::Null])).unwrap();
        assert_eq!(done(done_step), Value::Null);
    }

    #[test]
    fn complete_setup_takes_no_arguments() {
        let q = sent(step("completeSetup", &call(vec![], vec![])).unwrap());
        assert_eq!(q.rpc.as_deref(), Some("complete_org_setup"));
        assert_eq!(q.body, Some(json!({})));
    }
}
