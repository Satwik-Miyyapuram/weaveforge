//! Joining, switching and leaving labs, and the lab lists.

use serde_json::{Value, json};

use wf_core::org::{normalize_invite_code, resolve_join_assignment};

use crate::org::{
    ORG_COLUMNS, OrgError, OrgService, db_error_message, first, invite_code_hash, text,
};
use crate::postgrest::eq;

/// The database message when a code was revoked between the read and the join.
const CODE_NO_LONGER_VALID: &str = "invite code is no longer valid";

/// The `joined_via` value of rows written before join sources were recorded.
const LEGACY_JOIN: &str = "legacy";

impl OrgService<'_> {
    /// Join a lab with an invite code; the supervisor is picked by the role's rules.
    pub async fn join_organization(
        &self,
        user_id: &str,
        code: &str,
        phd_supervisor_id: Option<&str>,
        professor_supervisor_id: Option<&str>,
    ) -> Result<Value, OrgError> {
        self.ensure_profile(user_id).await?;
        let normalized = normalize_invite_code(code);
        if normalized.is_empty() {
            return Err(OrgError::Validation("Enter a join code.".to_string()));
        }
        let invite = self.find_join_code(&normalized).await?;
        let org_id = text(&invite, "org_id").unwrap_or_default();
        let org = self.find_lab(&org_id).await?;
        if self
            .membership(user_id, &org_id, "id,joined_via")
            .await?
            .is_some_and(|row| text(&row, "joined_via").as_deref() != Some(LEGACY_JOIN))
        {
            return Err(OrgError::Validation(
                "You are already in this lab.".to_string(),
            ));
        }

        let mut professors = self.member_ids(&org_id, "professor").await?;
        if professors.is_empty() {
            professors.push(text(&org, "owner_id").unwrap_or_default());
        }
        let phds = self.member_ids(&org_id, "phd").await?;
        let target = text(&invite, "target_role").unwrap_or_default();
        let assignment = resolve_join_assignment(
            &target,
            &professors,
            &phds,
            professor_supervisor_id,
            phd_supervisor_id,
        )
        .map_err(|message| OrgError::Validation(message.to_string()))?;

        let args = json!({
            "p_user_id": user_id,
            "p_org_id": org_id,
            "p_code_id": text(&invite, "id").unwrap_or_default(),
            "p_role": assignment.role,
            "p_supervisor_id": assignment.supervisor_id,
        });
        if let Err(err) = self.db().rpc("join_organization_atomic", &args).await {
            let revoked = db_error_message(&err).as_deref() == Some(CODE_NO_LONGER_VALID);
            return Err(if revoked {
                OrgError::Validation(CODE_NO_LONGER_VALID.to_string())
            } else {
                OrgError::Db(err)
            });
        }
        Ok(json!({"orgId": org_id}))
    }

    /// Make `org_id` the caller's active lab, with the role they hold there.
    pub async fn switch_active_organization(
        &self,
        user_id: &str,
        org_id: &str,
    ) -> Result<(), OrgError> {
        self.ensure_profile(user_id).await?;
        let Some(membership) = self
            .membership(user_id, org_id, "role,supervisor_id")
            .await?
        else {
            return Err(OrgError::Permission(
                "Not a member of this lab.".to_string(),
            ));
        };
        let patch = json!({
            "active_org_id": org_id,
            "role": text(&membership, "role"),
            "supervisor_id": supervisor_value(&membership),
            "org_setup_complete": true,
        });
        self.db()
            .update("profiles", &[("user_id", eq(user_id))], &patch)
            .await?;
        Ok(())
    }

    /// Remove the caller from `org_id`, and move their active lab if it was this one.
    pub async fn leave_organization(&self, user_id: &str, org_id: &str) -> Result<(), OrgError> {
        self.ensure_profile(user_id).await?;
        let org_query = [
            ("select", "owner_id".to_string()),
            ("id", eq(org_id)),
            ("limit", "1".to_string()),
        ];
        let org = first(self.db().select("organizations", &org_query).await?)
            .ok_or_else(|| OrgError::NotFound("Lab not found.".to_string()))?;
        if text(&org, "owner_id").as_deref() == Some(user_id) {
            return Err(OrgError::Permission(
                "Lab owners cannot leave — delete the lab or transfer ownership first.".to_string(),
            ));
        }
        if self.membership(user_id, org_id, "id").await?.is_none() {
            return Err(OrgError::Permission(
                "Not a member of this lab.".to_string(),
            ));
        }
        let membership = [("org_id", eq(org_id)), ("user_id", eq(user_id))];
        self.db().delete("org_memberships", &membership).await?;
        self.repoint_active_profile(user_id, org_id).await
    }

    /// The lab memberships the caller holds, oldest first, as the app's view rows.
    pub async fn list_memberships(&self, user_id: &str) -> Result<Value, OrgError> {
        let query = [
            (
                "select",
                "org_id,role,joined_via,organizations(name)".to_string(),
            ),
            ("user_id", eq(user_id)),
            ("order", "joined_at.asc".to_string()),
        ];
        let rows = self.db().select("org_memberships", &query).await?;
        Ok(Value::Array(rows.iter().map(membership_view).collect()))
    }

    /// The labs the caller owns, oldest first.
    pub async fn list_owned(&self, user_id: &str) -> Result<Value, OrgError> {
        let query = [
            ("select", ORG_COLUMNS.to_string()),
            ("owner_id", eq(user_id)),
            ("order", "created_at.asc".to_string()),
        ];
        let rows = self.db().select("organizations", &query).await?;
        Ok(Value::Array(rows.iter().map(owned_view).collect()))
    }

    /// The invite code row for a normalized `code`, when it is still live.
    async fn find_join_code(&self, normalized: &str) -> Result<Value, OrgError> {
        let query = [
            (
                "select",
                "id,org_id,target_role,code_hash,revoked_at".to_string(),
            ),
            ("code_hash", eq(&invite_code_hash(normalized))),
            ("revoked_at", "is.null".to_string()),
            ("limit", "1".to_string()),
        ];
        first(self.db().select("org_invite_codes", &query).await?)
            .ok_or_else(|| OrgError::Validation("Invalid or expired join code.".to_string()))
    }

    /// The lab `org_id` for a join; a read error or a missing row both mean no lab.
    async fn find_lab(&self, org_id: &str) -> Result<Value, OrgError> {
        let query = [
            ("select", ORG_COLUMNS.to_string()),
            ("id", eq(org_id)),
            ("limit", "1".to_string()),
        ];
        self.db()
            .select("organizations", &query)
            .await
            .ok()
            .and_then(first)
            .ok_or_else(|| OrgError::NotFound("Lab not found.".to_string()))
    }

    /// The caller's membership row in `org_id` with the `select` columns; None when not a member.
    async fn membership(
        &self,
        user_id: &str,
        org_id: &str,
        select: &str,
    ) -> Result<Option<Value>, OrgError> {
        let query = [
            ("select", select.to_string()),
            ("org_id", eq(org_id)),
            ("user_id", eq(user_id)),
            ("limit", "1".to_string()),
        ];
        Ok(first(self.db().select("org_memberships", &query).await?))
    }

    /// Point the profile at the caller's newest remaining lab when `org_id` was active.
    async fn repoint_active_profile(&self, user_id: &str, org_id: &str) -> Result<(), OrgError> {
        let query = [
            ("select", "active_org_id".to_string()),
            ("user_id", eq(user_id)),
            ("limit", "1".to_string()),
        ];
        let profile = first(self.db().select("profiles", &query).await?);
        let active = profile.as_ref().and_then(|row| text(row, "active_org_id"));
        if active.as_deref() != Some(org_id) {
            return Ok(());
        }

        let next_query = [
            ("select", "org_id,role,supervisor_id".to_string()),
            ("user_id", eq(user_id)),
            ("order", "joined_at.desc".to_string()),
            ("limit", "1".to_string()),
        ];
        let patch = match first(self.db().select("org_memberships", &next_query).await?) {
            Some(next) => json!({
                "active_org_id": text(&next, "org_id"),
                "role": text(&next, "role"),
                "supervisor_id": supervisor_value(&next),
                "org_setup_complete": true,
            }),
            None => json!({
                "active_org_id": null,
                "supervisor_id": null,
                "role": "standalone",
                "org_setup_complete": true,
            }),
        };
        self.db()
            .update("profiles", &[("user_id", eq(user_id))], &patch)
            .await?;
        Ok(())
    }
}

/// The stored `supervisor_id` as it is, null included.
fn supervisor_value(row: &Value) -> Value {
    row.get("supervisor_id").cloned().unwrap_or(Value::Null)
}

/// One `org_memberships` row as the app's membership view.
fn membership_view(row: &Value) -> Value {
    let join_source = match text(row, "joined_via").as_deref() {
        Some("invite") => "invite",
        Some("create") => "create",
        _ => LEGACY_JOIN,
    };
    json!({
        "orgId": text(row, "org_id"),
        "orgName": org_name(row),
        "role": text(row, "role"),
        "joinSource": join_source,
    })
}

/// The lab name from the embedded `organizations`, an object or a one-element array.
fn org_name(row: &Value) -> String {
    let name = match row.get("organizations") {
        Some(Value::Array(items)) => items.first().and_then(|org| text(org, "name")),
        Some(org) => text(org, "name"),
        None => None,
    };
    name.unwrap_or_else(|| "Lab".to_string())
}

/// One `organizations` row as the app's owned-lab view.
fn owned_view(row: &Value) -> Value {
    json!({
        "id": text(row, "id"),
        "name": text(row, "name"),
        "ownerId": text(row, "owner_id"),
        "createdAt": text(row, "created_at"),
    })
}
