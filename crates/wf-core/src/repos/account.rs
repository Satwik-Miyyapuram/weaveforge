//! Account set-up and removal as Rust-planned queries.
//!
//! Ported from `SupabaseAdminUserProvisioner` (`backend/providers/supabase-auth/parts.ts`) and
//! `PostgrestSelfProvisioner` (`backend/parts.ts`). The Supabase auth calls (user lookup,
//! create, delete) stay in TS: sign-in is Supabase's, not the database's.

use serde::Deserialize;
use serde_json::json;

use crate::member_rows::{ProfileRow, to_domain};
use crate::repo_query::{RepoCall, RepoQuery, RepoStep, map_row};
use crate::repos::members::PROFILE_COLUMNS;

const PROFILES: &str = "profiles";

/// The next step of `method`, or `None` for an unknown method.
#[must_use]
pub fn step(method: &str, call: &RepoCall) -> Option<RepoStep> {
    Some(match method {
        "profile" => profile(call),
        "saveProfile" => save_profile(call),
        "deleteData" => delete_data(call),
        "ensureProvisioned" => ensure_provisioned(call),
        _ => return None,
    })
}

/// A new user's profile as the admin provisioner writes it.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProfileInput {
    user_id: String,
    email: String,
    #[serde(default)]
    full_name: Option<String>,
    role: String,
    #[serde(default)]
    supervisor_id: Option<String>,
}

/// `profile(userId)`: that user's member, or `null` when there is no profile row.
fn profile(call: &RepoCall) -> RepoStep {
    if call.replies.is_empty() {
        return RepoStep::send(
            RepoQuery::select(PROFILES, PROFILE_COLUMNS)
                .eq("user_id", call.text(0))
                .maybe_single(),
        );
    }
    map_row(call, 0, |row: &Option<ProfileRow>| {
        row.as_ref().map(to_domain)
    })
}

/// `saveProfile(input)`: upserts the profile of a user the admin just created.
fn save_profile(call: &RepoCall) -> RepoStep {
    if !call.replies.is_empty() {
        return RepoStep::unit();
    }
    let p: ProfileInput = match call.parse(0) {
        Ok(p) => p,
        Err(e) => return RepoStep::fail(e),
    };
    RepoStep::send(RepoQuery::upsert(
        PROFILES,
        json!({
            "user_id": p.user_id,
            "email": p.email,
            "full_name": p.full_name,
            "role": p.role,
            "supervisor_id": p.supervisor_id,
        }),
    ))
}

/// `deleteData(userId)`: removes every row the user owns (`delete_user_account_data`).
fn delete_data(call: &RepoCall) -> RepoStep {
    if !call.replies.is_empty() {
        return RepoStep::unit();
    }
    RepoStep::send(RepoQuery::rpc(
        "delete_user_account_data",
        json!({ "p_user_id": call.text(0) }),
    ))
}

/// `ensureProvisioned()`: creates the caller's profile and defaults if missing.
fn ensure_provisioned(call: &RepoCall) -> RepoStep {
    if !call.replies.is_empty() {
        return RepoStep::unit();
    }
    RepoStep::send(RepoQuery::rpc("ensure_user_provisioned", json!({})))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repo_query::{RepoAction, RepoCtx, RepoSingle};
    use serde_json::Value;

    fn call(args: Vec<Value>, replies: Vec<Value>) -> RepoCall {
        RepoCall {
            args,
            replies,
            ctx: RepoCtx::default(),
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
    fn profile_reads_one_row_by_user_and_maps_it() {
        let q = sent(profile(&call(vec![json!("u1")], vec![])));
        assert_eq!(q.table, PROFILES);
        assert_eq!(q.columns.as_deref(), Some(PROFILE_COLUMNS));
        assert_eq!(q.filters[0].column, "user_id");
        assert_eq!(q.filters[0].value, "u1");
        assert_eq!(q.single, RepoSingle::Maybe);
        let row = json!({ "user_id": "u1", "email": "a@b.c", "full_name": null,
            "role": "student", "supervisor_id": null });
        let v = done(profile(&call(vec![json!("u1")], vec![row])));
        assert_eq!(v["id"], "u1");
        assert_eq!(v["email"], "a@b.c");
        assert_eq!(v["role"], "student");
        assert!(v.get("fullName").is_none());
        assert!(v.get("supervisorId").is_none());
        assert_eq!(
            done(profile(&call(vec![json!("u1")], vec![Value::Null]))),
            Value::Null
        );
    }

    #[test]
    fn save_profile_upserts_with_nulls_for_missing_fields() {
        let input = json!({ "userId": "u1", "email": "a@b.c", "role": "student" });
        let q = sent(save_profile(&call(vec![input], vec![])));
        assert_eq!(q.action, RepoAction::Upsert);
        assert_eq!(
            q.body.unwrap(),
            json!({ "user_id": "u1", "email": "a@b.c", "full_name": null,
                "role": "student", "supervisor_id": null })
        );
        assert_eq!(
            done(save_profile(&call(vec![], vec![Value::Null]))),
            Value::Null
        );
    }

    #[test]
    fn delete_data_and_ensure_provisioned_call_their_rpcs() {
        let q = sent(delete_data(&call(vec![json!("u1")], vec![])));
        assert_eq!(q.rpc.as_deref(), Some("delete_user_account_data"));
        assert_eq!(q.body.unwrap(), json!({ "p_user_id": "u1" }));
        let q = sent(ensure_provisioned(&call(vec![], vec![])));
        assert_eq!(q.rpc.as_deref(), Some("ensure_user_provisioned"));
        assert_eq!(q.body.unwrap(), json!({}));
    }

    #[test]
    fn unknown_method_is_none() {
        assert!(step("nope", &call(vec![], vec![])).is_none());
    }
}
