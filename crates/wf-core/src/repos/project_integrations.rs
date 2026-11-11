//! The `project_integrations` row queries, Rust-planned.
//!
//! Ported from `PostgrestIntegrationsStore` (`get`, `save`) in
//! `apps/web/src/backend/providers/postgrest/wire-postgrest-backend.ts`. The branch rules are
//! `crate::sync::integration_store` and the empty integration is `crate::sync::integration_fields`.

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::repo_query::{RepoCall, RepoQuery, RepoStep};
use crate::sync::integration_fields::{SyncProvider, empty_integration};
use crate::sync::integration_store::{BranchReadInput, BranchSaveInput, branch_read, branch_save};

const TABLE: &str = "project_integrations";

/// The columns an integration row is read as, named rather than starred.
const INTEGRATION_COLUMNS: &str = "provider,enabled,token,repo,branch,options";

/// The next step of `method`, or `None` for an unknown method.
#[must_use]
pub fn step(method: &str, call: &RepoCall) -> Option<RepoStep> {
    Some(match method {
        "get" => get(call),
        "save" => save(call),
        _ => return None,
    })
}

/// A stored `project_integrations` row, as read with `INTEGRATION_COLUMNS`.
#[derive(Deserialize)]
struct IntegrationRow {
    enabled: bool,
    token: Option<String>,
    repo: Option<String>,
    branch: Option<String>,
    options: Option<Value>,
}

/// An integration as the app models it (TS `Integration`); unset fields are left out.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Integration {
    provider: SyncProvider,
    enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    token: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    repo: Option<String>,
    branch: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    options: Option<Value>,
}

/// `get(projectId, provider)`: the stored integration, or the empty one when no row exists.
fn get(call: &RepoCall) -> RepoStep {
    let Some(reply) = call.reply::<Option<IntegrationRow>>(0) else {
        return RepoStep::send(
            RepoQuery::select(TABLE, INTEGRATION_COLUMNS)
                .eq("project_id", call.text(0))
                .eq("provider", call.arg(1).clone())
                .maybe_single(),
        );
    };
    let provider: SyncProvider = match call.parse(1) {
        Ok(provider) => provider,
        Err(e) => return RepoStep::fail(e),
    };
    match reply {
        Err(e) => RepoStep::fail(e),
        Ok(None) => RepoStep::done(&empty_integration(provider)),
        Ok(Some(row)) => RepoStep::done(&Integration {
            provider,
            enabled: row.enabled,
            token: row.token,
            repo: row.repo,
            branch: branch_read(&BranchReadInput {
                provider,
                branch: row.branch,
            }),
            options: row.options,
        }),
    }
}

/// `save(projectId, integration)`: upsert per (project, provider).
fn save(call: &RepoCall) -> RepoStep {
    if !call.replies.is_empty() {
        return RepoStep::unit();
    }
    let integration: SaveInput = match call.parse(1) {
        Ok(integration) => integration,
        Err(e) => return RepoStep::fail(e),
    };
    RepoStep::send(
        RepoQuery::upsert(
            TABLE,
            json!({
                "project_id": call.text(0),
                "provider": integration.provider,
                "enabled": integration.enabled,
                "token": integration.token,
                "repo": integration.repo,
                // For Mattermost this is the channel id; a blank one stays blank.
                "branch": branch_save(&BranchSaveInput {
                    provider: integration.provider,
                    branch: integration.branch.unwrap_or_default(),
                }),
                "options": integration.options.unwrap_or_else(|| json!({})),
                "updated_at": call.now(),
            }),
        )
        .on_conflict("project_id,provider", false),
    )
}

/// An integration as the app sends it to `save` (TS `Integration`).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveInput {
    provider: SyncProvider,
    enabled: bool,
    token: Option<String>,
    repo: Option<String>,
    branch: Option<String>,
    options: Option<Value>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repo_query::{RepoAction, RepoCtx, RepoSingle};

    fn call(args: Vec<Value>, replies: Vec<Value>) -> RepoCall {
        RepoCall {
            args,
            replies,
            ctx: RepoCtx {
                now: Some("2026-11-11T10:00:00Z".into()),
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
    fn get_reads_by_project_and_provider() {
        let q = sent(get(&call(vec![json!("p1"), json!("github")], vec![])));
        assert_eq!(q.action, RepoAction::Select);
        assert_eq!(q.columns.as_deref(), Some(INTEGRATION_COLUMNS));
        assert_eq!(q.filters[0].column, "project_id");
        assert_eq!(q.filters[1].column, "provider");
        assert_eq!(q.filters[1].value, "github");
        assert_eq!(q.single, RepoSingle::Maybe);
    }

    #[test]
    fn get_without_a_row_is_the_empty_integration() {
        let v = done(get(&call(
            vec![json!("p1"), json!("github")],
            vec![Value::Null],
        )));
        assert_eq!(
            v,
            json!({ "provider": "github", "enabled": false, "branch": "main" })
        );
        let v = done(get(&call(
            vec![json!("p1"), json!("mattermost")],
            vec![Value::Null],
        )));
        assert_eq!(v["branch"], "");
    }

    #[test]
    fn get_maps_the_row_and_leaves_out_unset_fields() {
        let row =
            json!({ "enabled": true, "token": "t", "repo": null, "branch": null, "options": null });
        let v = done(get(&call(vec![json!("p1"), json!("github")], vec![row])));
        assert_eq!(v["token"], "t");
        assert_eq!(v["branch"], "main");
        assert_eq!(v["enabled"], true);
        assert!(v.get("repo").is_none());
        assert!(v.get("options").is_none());
    }

    #[test]
    fn get_fails_on_an_unknown_provider() {
        let step = get(&call(vec![json!("p1"), json!("nope")], vec![Value::Null]));
        assert!(matches!(step, RepoStep::Fail { .. }));
    }

    #[test]
    fn save_upserts_per_project_and_provider() {
        let integration = json!({ "provider": "github", "enabled": true, "branch": "" });
        let q = sent(save(&call(vec![json!("p1"), integration], vec![])));
        assert_eq!(q.action, RepoAction::Upsert);
        assert_eq!(q.on_conflict.as_deref(), Some("project_id,provider"));
        let body = q.body.unwrap();
        assert_eq!(body["project_id"], "p1");
        assert_eq!(body["branch"], "main");
        assert_eq!(body["token"], Value::Null);
        assert_eq!(body["options"], json!({}));
        assert_eq!(body["updated_at"], "2026-11-11T10:00:00Z");
    }

    #[test]
    fn save_keeps_a_blank_mattermost_channel() {
        let integration = json!({ "provider": "mattermost", "enabled": false });
        let body = sent(save(&call(vec![json!("p1"), integration], vec![])))
            .body
            .unwrap();
        assert_eq!(body["branch"], "");
    }

    #[test]
    fn save_is_unit_after_the_write() {
        assert_eq!(
            done(save(&call(vec![json!("p1"), json!({})], vec![Value::Null]))),
            Value::Null
        );
    }
}
