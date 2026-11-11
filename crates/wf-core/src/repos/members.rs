//! The `profiles` member repository (migration 0018) as Rust-planned queries.
//!
//! Ported from `apps/web/src/features/org/infrastructure/postgrest-member-repository.ts`.
//! The profiles SELECT policy covers the whole lab, so `listDirectory` is the full lab and
//! the team and lab views are filtered by the caller (`filterTeamMembers`,
//! `filterLabMembers`) with the context `labContext` returns.

use serde::Deserialize;
use serde_json::json;

use crate::js_collate::locale_compare;
use crate::member_rows::{Member, ProfileRow, to_domain};
use crate::org::{Membership, is_explicit_lab_membership};
use crate::repo_query::{RepoCall, RepoQuery, RepoStep, map_row};

const TABLE: &str = "profiles";

/// The columns a [`ProfileRow`] is read as, named rather than starred.
pub const PROFILE_COLUMNS: &str =
    "user_id,email,full_name,role,supervisor_id,org_setup_complete,active_org_id";

/// The next step of `method`, or `None` for an unknown method.
#[must_use]
pub fn step(method: &str, call: &RepoCall) -> Option<RepoStep> {
    Some(match method {
        "getMine" => get_mine(call),
        "listDirectory" => list_directory(call),
        "labContext" => lab_context(call),
        _ => return None,
    })
}

/// `getMine()`: the signed-in member, or `null` when signed out or without a profile.
fn get_mine(call: &RepoCall) -> RepoStep {
    let Some(uid) = call.ctx.user_id.as_deref().filter(|id| !id.is_empty()) else {
        return RepoStep::Done {
            value: serde_json::Value::Null,
        };
    };
    if call.replies.is_empty() {
        return RepoStep::send(
            RepoQuery::select(TABLE, PROFILE_COLUMNS)
                .eq("user_id", uid)
                .maybe_single(),
        );
    }
    map_row(call, 0, |row: &Option<ProfileRow>| {
        row.as_ref().map(to_domain)
    })
}

/// Members by full name, else email, as `localeCompare` orders them.
fn by_name(a: &Member, b: &Member) -> std::cmp::Ordering {
    let key = |m: &Member| {
        m.full_name
            .clone()
            .or_else(|| m.email.clone())
            .unwrap_or_default()
    };
    locale_compare(&key(a), &key(b))
}

/// `listDirectory()`: every profile the caller may read, by name.
fn list_directory(call: &RepoCall) -> RepoStep {
    if call.replies.is_empty() {
        return RepoStep::send(RepoQuery::select(TABLE, PROFILE_COLUMNS));
    }
    match call.reply::<Vec<ProfileRow>>(0) {
        Some(Ok(rows)) => {
            let mut members: Vec<Member> = rows.iter().map(to_domain).collect();
            members.sort_by(by_name);
            RepoStep::done(&members)
        }
        Some(Err(e)) => RepoStep::fail(e),
        None => RepoStep::fail("reply 0 missing"),
    }
}

#[derive(Deserialize)]
struct OwnerRow {
    owner_id: Option<String>,
}

#[derive(Deserialize)]
struct JoinRow {
    joined_via: Option<String>,
}

#[derive(Deserialize)]
struct UserIdRow {
    user_id: String,
}

/// `labContext(activeOrgId)`: `{ inLab, orgMemberIds }` for the team and lab filters.
///
/// The active org counts only when the caller owns it or joined it explicitly (not a
/// migration backfill); otherwise `orgMemberIds` is `null`. The three reads go out together.
fn lab_context(call: &RepoCall) -> RepoStep {
    let outside = RepoStep::Done {
        value: json!({ "inLab": false, "orgMemberIds": null }),
    };
    let uid = match call.user() {
        Ok(uid) => uid,
        Err(_) => return outside,
    };
    let org_id = call.text(0);
    if org_id.is_empty() {
        return outside;
    }
    if call.replies.is_empty() {
        return RepoStep::Send {
            queries: vec![
                RepoQuery::select("organizations", "owner_id")
                    .eq("id", org_id)
                    .maybe_single(),
                RepoQuery::select("org_memberships", "joined_via")
                    .eq("org_id", org_id)
                    .eq("user_id", uid)
                    .maybe_single(),
                RepoQuery::select("org_memberships", "user_id").eq("org_id", org_id),
            ],
        };
    }
    let (Some(Ok(org)), Some(Ok(join)), Some(Ok(ids))) = (
        call.reply::<Option<OwnerRow>>(0),
        call.reply::<Option<JoinRow>>(1),
        call.reply::<Vec<UserIdRow>>(2),
    ) else {
        return RepoStep::fail("labContext: a reply is missing or malformed");
    };
    let owns = org.and_then(|o| o.owner_id).as_deref() == Some(uid);
    let joined = join.is_some_and(|j| {
        is_explicit_lab_membership(&Membership {
            org_id: org_id.to_owned(),
            join_source: j.joined_via,
        })
    });
    if !owns && !joined {
        return outside;
    }
    let ids: Vec<String> = ids.into_iter().map(|r| r.user_id).collect();
    RepoStep::Done {
        value: json!({ "inLab": true, "orgMemberIds": ids }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repo_query::{RepoCtx, RepoSingle};
    use serde_json::Value;

    fn call(user: Option<&str>, args: Vec<Value>, replies: Vec<Value>) -> RepoCall {
        RepoCall {
            args,
            replies,
            ctx: RepoCtx {
                user_id: user.map(Into::into),
                ..RepoCtx::default()
            },
        }
    }

    fn profile(id: &str, name: Option<&str>, email: Option<&str>) -> Value {
        json!({
            "user_id": id, "email": email, "full_name": name, "role": "phd",
            "supervisor_id": null, "org_setup_complete": null, "active_org_id": null
        })
    }

    fn done(step: RepoStep) -> Value {
        match step {
            RepoStep::Done { value } => value,
            other => panic!("expected done, got {other:?}"),
        }
    }

    #[test]
    fn get_mine_signed_out_is_null_without_a_query() {
        assert_eq!(done(get_mine(&call(None, vec![], vec![]))), Value::Null);
    }

    #[test]
    fn get_mine_reads_own_row_maybe_single() {
        let RepoStep::Send { queries } = get_mine(&call(Some("u1"), vec![], vec![])) else {
            panic!()
        };
        assert_eq!(queries[0].filters[0].value, json!("u1"));
        assert_eq!(queries[0].single, RepoSingle::Maybe);
        let none = get_mine(&call(Some("u1"), vec![], vec![Value::Null]));
        assert_eq!(done(none), Value::Null);
        let some = get_mine(&call(Some("u1"), vec![], vec![profile("u1", None, None)]));
        let v = done(some);
        assert_eq!(v["id"], "u1");
        assert_eq!(v["orgSetupComplete"], false);
        assert!(v.get("email").is_none());
    }

    #[test]
    fn list_directory_sorts_by_name_then_email() {
        let rows = json!([
            profile("b", Some("bob"), None),
            profile("a", None, Some("Alice@x")),
            profile("c", Some("Carol"), None),
        ]);
        let v = done(list_directory(&call(None, vec![], vec![rows])));
        let ids: Vec<&str> = v
            .as_array()
            .unwrap()
            .iter()
            .map(|m| m["id"].as_str().unwrap())
            .collect();
        assert_eq!(ids, ["a", "b", "c"]);
    }

    #[test]
    fn lab_context_outside_without_org_or_user() {
        let out = json!({ "inLab": false, "orgMemberIds": null });
        assert_eq!(
            done(lab_context(&call(Some("u1"), vec![json!("")], vec![]))),
            out
        );
        assert_eq!(
            done(lab_context(&call(None, vec![json!("o1")], vec![]))),
            out
        );
    }

    #[test]
    fn lab_context_sends_three_reads() {
        let RepoStep::Send { queries } = lab_context(&call(Some("u1"), vec![json!("o1")], vec![]))
        else {
            panic!()
        };
        assert_eq!(queries.len(), 3);
        assert_eq!(queries[0].table, "organizations");
        assert_eq!(queries[1].filters[1].value, json!("u1"));
        assert_eq!(queries[2].columns.as_deref(), Some("user_id"));
    }

    #[test]
    fn lab_context_owner_is_in_lab() {
        let replies = vec![
            json!({ "owner_id": "u1" }),
            Value::Null,
            json!([{ "user_id": "u1" }, { "user_id": "u2" }]),
        ];
        let v = done(lab_context(&call(Some("u1"), vec![json!("o1")], replies)));
        assert_eq!(v, json!({ "inLab": true, "orgMemberIds": ["u1", "u2"] }));
    }

    #[test]
    fn lab_context_backfill_membership_is_outside() {
        let replies = vec![
            json!({ "owner_id": "x" }),
            json!({ "joined_via": "backfill" }),
            json!([{ "user_id": "u1" }]),
        ];
        let v = done(lab_context(&call(Some("u1"), vec![json!("o1")], replies)));
        assert_eq!(v["inLab"], false);
        let invited = vec![
            Value::Null,
            json!({ "joined_via": "invite" }),
            json!([{ "user_id": "u1" }]),
        ];
        let v = done(lab_context(&call(Some("u1"), vec![json!("o1")], invited)));
        assert_eq!(v["inLab"], true);
    }
}
