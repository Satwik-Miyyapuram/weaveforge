//! The `profiles` member repository (migration 0018) as Rust-planned queries.
//!
//! Ported from `apps/web/src/features/org/infrastructure/postgrest-member-repository.ts`.
//! The profiles SELECT policy covers the whole lab, so `listDirectory` is the full lab and
//! the team and lab views are filtered by the caller (`filterTeamMembers`,
//! `filterLabMembers`) with the context `labContext` returns.

use serde::Deserialize;
use serde_json::json;

use crate::js_collate::locale_compare;
use crate::member::can_create_role;
use crate::member_rows::{Member, ProfileRow, to_domain};
use crate::org::{Membership, is_explicit_lab_membership};
use crate::repo_query::{RepoCall, RepoQuery, RepoStep, map_row};
use serde_json::Value;

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
        "assertCanCreate" => assert_can_create(call),
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

/// `assertCanCreate(role)`: the client-side hierarchy gate of the create-member flow. Reads the
/// signed-in member, then fails as `MemberPermissionError` when there is none or when they may not
/// create `role`. The account itself is made by the server route (`HttpAccountProvisioner`), which
/// re-checks the same rule, so this step only answers yes or no.
fn assert_can_create(call: &RepoCall) -> RepoStep {
    let target = call.text(0);
    match get_mine(&call.sub(Vec::new(), 0)) {
        RepoStep::Done { value } if value.is_null() => RepoStep::fail_named(
            "MemberPermissionError",
            "Only registered members can create accounts.",
        ),
        RepoStep::Done { value } => {
            let role = value
                .get("role")
                .and_then(Value::as_str)
                .unwrap_or_default();
            if can_create_role(role, target) {
                RepoStep::unit()
            } else {
                RepoStep::fail_named(
                    "MemberPermissionError",
                    format!("A {role} cannot create a {target} account."),
                )
            }
        }
        other => other,
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

    fn me(role: &str) -> Value {
        json!({
            "user_id": "me", "email": null, "full_name": null, "role": role,
            "supervisor_id": null, "org_setup_complete": null, "active_org_id": null
        })
    }

    fn denied(message: &str) -> RepoStep {
        RepoStep::fail_named("MemberPermissionError", message)
    }

    #[test]
    fn assert_can_create_reads_the_signed_in_member_first() {
        let RepoStep::Send { queries } =
            assert_can_create(&call(Some("prof"), vec![json!("phd")], vec![]))
        else {
            panic!()
        };
        assert_eq!(queries[0].filters[0].value, json!("prof"));
        assert_eq!(queries[0].single, RepoSingle::Maybe);
    }

    #[test]
    fn professor_can_create_a_phd_account() {
        let step = assert_can_create(&call(
            Some("prof"),
            vec![json!("phd")],
            vec![me("professor")],
        ));
        assert_eq!(step, RepoStep::unit());
    }

    #[test]
    fn phd_cannot_create_a_professor() {
        let step = assert_can_create(&call(
            Some("phd"),
            vec![json!("professor")],
            vec![me("phd")],
        ));
        assert_eq!(step, denied("A phd cannot create a professor account."));
    }

    #[test]
    fn masters_cannot_create_masters() {
        let step = assert_can_create(&call(
            Some("msc"),
            vec![json!("masters")],
            vec![me("masters")],
        ));
        assert_eq!(step, denied("A masters cannot create a masters account."));
    }

    #[test]
    fn a_non_member_cannot_create_accounts() {
        let message = "Only registered members can create accounts.";
        let signed_out = assert_can_create(&call(None, vec![json!("masters")], vec![]));
        assert_eq!(signed_out, denied(message));
        let no_profile =
            assert_can_create(&call(Some("x"), vec![json!("masters")], vec![Value::Null]));
        assert_eq!(no_profile, denied(message));
    }

    #[test]
    fn hierarchy_allows_only_strictly_lower_ranks() {
        assert!(can_create_role("professor", "phd"));
        assert!(!can_create_role("professor", "professor"));
        assert!(can_create_role("phd", "masters"));
        assert!(!can_create_role("phd", "phd"));
        assert!(!can_create_role("masters", "masters"));
    }

    #[test]
    fn create_validation_normalizes_and_rejects_a_short_password() {
        let ok =
            crate::member::validate_new_member("New@Uni.edu", "supersecret", None, "phd", None)
                .unwrap();
        assert_eq!(ok.email, "new@uni.edu");
        let short = crate::member::validate_new_member("x@uni.edu", "short", None, "phd", None);
        assert_eq!(
            short,
            Err("Password must be at least 8 characters.".to_owned())
        );
    }

    #[test]
    fn filter_lab_members_standalone_user_sees_only_themselves() {
        let team = vec![
            crate::member::MemberLink {
                id: "prof".to_owned(),
                supervisor_id: None,
            },
            crate::member::MemberLink {
                id: "ms2".to_owned(),
                supervisor_id: Some("prof".to_owned()),
            },
        ];
        let solo = crate::member::filter_lab_members(
            "ms2",
            &team,
            &crate::member::TeamVisibility::default(),
        );
        assert_eq!(solo, vec![1]);
    }
}
