//! Where shared documents and their grants are kept: PostgREST in production,
//! an in-memory map for tests and local runs.

use std::collections::HashMap;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use wf_core::sync::instant::format_instant;

use crate::collab::{BoxFut, Permission};
use crate::postgrest::{UserDb, eq};

/// Whether a shared document is live or being deleted.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DocStatus {
    /// Normal.
    Open,
    /// Unshared: deleted when the holder's lease is released.
    Closing,
}

impl DocStatus {
    /// The database spelling.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Open => "open",
            Self::Closing => "closing",
        }
    }

    /// Parses `open` or `closing`.
    #[must_use]
    pub fn parse(text: &str) -> Option<Self> {
        match text {
            "open" => Some(Self::Open),
            "closing" => Some(Self::Closing),
            _ => None,
        }
    }
}

/// One row of `shared_docs`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DocRow {
    /// The item the document belongs to.
    pub item_id: String,
    /// The user who shared it.
    pub owner: String,
    /// `annotations`, `canvas`, `feed` or `note`.
    pub kind: String,
    /// The project the item sits in, for project grants.
    pub project_id: Option<String>,
    /// The workspace the item sits in.
    pub workspace_id: Option<String>,
    /// Bumped on restore; clients on an older epoch rejoin.
    pub epoch: i64,
    /// The document format version.
    pub format_version: i64,
    /// The full Yjs state (v1 update bytes).
    pub state: Vec<u8>,
    /// Open or closing.
    pub status: DocStatus,
}

/// What `create_grant` needs.
#[derive(Clone, Debug)]
pub struct NewGrant {
    /// The sharer.
    pub owner: String,
    /// `item` or `project`.
    pub scope: String,
    /// The item id or project id the grant covers.
    pub target_id: String,
    /// The user the grant is for.
    pub grantee_user: String,
    /// What the grantee may do.
    pub permission: Permission,
    /// When the grant stops working, if ever.
    pub expires_at: Option<String>,
}

/// One row of `grants`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct GrantRow {
    /// The grant id.
    pub id: String,
    /// The sharer.
    pub owner: String,
    /// `item` or `project`.
    pub scope: String,
    /// The item id or project id the grant covers.
    pub target_id: String,
    /// The grantee; `None` for link grants.
    pub grantee_user: Option<String>,
    /// `view`, `comment` or `edit`.
    pub permission: String,
    /// When the grant stops working, if ever.
    pub expires_at: Option<String>,
    /// When the grant was revoked, if it was.
    pub revoked_at: Option<String>,
}

/// Document and grant storage, behind one interface.
pub trait SharedDocStore: Send + Sync {
    /// The document row for `item_id`, if any.
    fn load<'a>(&'a self, item_id: &'a str) -> BoxFut<'a, Result<Option<DocRow>, String>>;
    /// Inserts the row; an existing row wins (`ON CONFLICT DO NOTHING`).
    fn seed<'a>(&'a self, row: &'a DocRow) -> BoxFut<'a, Result<(), String>>;
    /// Writes state only while the row's epoch is still `epoch`.
    fn save_state<'a>(
        &'a self,
        item_id: &'a str,
        epoch: i64,
        state: &'a [u8],
    ) -> BoxFut<'a, Result<(), String>>;
    /// Replaces state and kind, bumps the epoch, clears the writer; returns the new epoch.
    /// Errors when there is no row.
    fn replace_state<'a>(
        &'a self,
        item_id: &'a str,
        kind: &'a str,
        state: &'a [u8],
    ) -> BoxFut<'a, Result<i64, String>>;
    /// Sets open or closing.
    fn set_status<'a>(
        &'a self,
        item_id: &'a str,
        status: DocStatus,
    ) -> BoxFut<'a, Result<(), String>>;
    /// Sets the write-back lease holder and its end time.
    fn set_writer<'a>(
        &'a self,
        item_id: &'a str,
        device: Option<&'a str>,
        until_ms: Option<i64>,
    ) -> BoxFut<'a, Result<(), String>>;
    /// Removes the document row.
    fn delete<'a>(&'a self, item_id: &'a str) -> BoxFut<'a, Result<(), String>>;
    /// What `user` may do with the document (`None`: nothing).
    fn access<'a>(
        &'a self,
        item_id: &'a str,
        user: &'a str,
    ) -> BoxFut<'a, Result<Option<Permission>, String>>;
    /// Stores a grant and returns the saved row.
    fn create_grant<'a>(&'a self, grant: &'a NewGrant) -> BoxFut<'a, Result<GrantRow, String>>;
    /// The owner's live grants, newest first, optionally for one target.
    fn list_grants<'a>(
        &'a self,
        owner: &'a str,
        target_id: Option<&'a str>,
    ) -> BoxFut<'a, Result<Vec<GrantRow>, String>>;
    /// Revokes the owner's grant; `Some(target_id)` when it existed.
    fn revoke_grant<'a>(
        &'a self,
        owner: &'a str,
        id: &'a str,
    ) -> BoxFut<'a, Result<Option<String>, String>>;
}

/// An in-memory store for tests and local runs.
/// Grant expiry is not checked here (the SQL function does check it).
pub struct MemoryStore {
    docs: Mutex<HashMap<String, DocRow>>,
    grants: Mutex<Vec<GrantRow>>,
    saves: Mutex<usize>,
    next_grant: Mutex<usize>,
}

impl MemoryStore {
    /// An empty store.
    #[must_use]
    pub fn new() -> Self {
        Self {
            docs: Mutex::new(HashMap::new()),
            grants: Mutex::new(Vec::new()),
            saves: Mutex::new(0),
            next_grant: Mutex::new(0),
        }
    }

    /// The document row for `item_id` (`None` when absent or the lock is poisoned).
    #[must_use]
    pub fn doc(&self, item_id: &str) -> Option<DocRow> {
        self.docs.lock().ok()?.get(item_id).cloned()
    }

    /// How many `save_state` calls actually wrote a row.
    #[must_use]
    pub fn saves(&self) -> usize {
        self.saves.lock().map_or(0, |count| *count)
    }
}

impl Default for MemoryStore {
    fn default() -> Self {
        Self::new()
    }
}

/// Whether grant `g` lets `user` reach the document `row` at `item_id`.
fn grant_covers(g: &GrantRow, row: &DocRow, item_id: &str, user: &str) -> bool {
    g.revoked_at.is_none()
        && g.owner == row.owner
        && g.grantee_user.as_deref() == Some(user)
        && ((g.scope == "item" && g.target_id == item_id)
            || (g.scope == "project" && Some(g.target_id.as_str()) == row.project_id.as_deref()))
}

impl SharedDocStore for MemoryStore {
    fn load<'a>(&'a self, item_id: &'a str) -> BoxFut<'a, Result<Option<DocRow>, String>> {
        Box::pin(async move {
            let docs = self
                .docs
                .lock()
                .map_err(|_| "store lock poisoned".to_owned())?;
            Ok(docs.get(item_id).cloned())
        })
    }

    fn seed<'a>(&'a self, row: &'a DocRow) -> BoxFut<'a, Result<(), String>> {
        Box::pin(async move {
            let mut docs = self
                .docs
                .lock()
                .map_err(|_| "store lock poisoned".to_owned())?;
            let _ = docs
                .entry(row.item_id.clone())
                .or_insert_with(|| row.clone());
            Ok(())
        })
    }

    fn save_state<'a>(
        &'a self,
        item_id: &'a str,
        epoch: i64,
        state: &'a [u8],
    ) -> BoxFut<'a, Result<(), String>> {
        Box::pin(async move {
            let written = {
                let mut docs = self
                    .docs
                    .lock()
                    .map_err(|_| "store lock poisoned".to_owned())?;
                match docs.get_mut(item_id) {
                    Some(row) if row.epoch == epoch => {
                        row.state = state.to_vec();
                        true
                    }
                    _ => false,
                }
            };
            if written {
                *self
                    .saves
                    .lock()
                    .map_err(|_| "store lock poisoned".to_owned())? += 1;
            }
            Ok(())
        })
    }

    fn replace_state<'a>(
        &'a self,
        item_id: &'a str,
        kind: &'a str,
        state: &'a [u8],
    ) -> BoxFut<'a, Result<i64, String>> {
        Box::pin(async move {
            let mut docs = self
                .docs
                .lock()
                .map_err(|_| "store lock poisoned".to_owned())?;
            let row = docs
                .get_mut(item_id)
                .ok_or_else(|| format!("no shared document {item_id}"))?;
            row.kind = kind.to_owned();
            row.state = state.to_vec();
            row.epoch = row.epoch.saturating_add(1);
            Ok(row.epoch)
        })
    }

    fn set_status<'a>(
        &'a self,
        item_id: &'a str,
        status: DocStatus,
    ) -> BoxFut<'a, Result<(), String>> {
        Box::pin(async move {
            let mut docs = self
                .docs
                .lock()
                .map_err(|_| "store lock poisoned".to_owned())?;
            if let Some(row) = docs.get_mut(item_id) {
                row.status = status;
            }
            Ok(())
        })
    }

    fn set_writer<'a>(
        &'a self,
        _item_id: &'a str,
        _device: Option<&'a str>,
        _until_ms: Option<i64>,
    ) -> BoxFut<'a, Result<(), String>> {
        // No writer fields in memory: the lease lives in the hub.
        Box::pin(async move { Ok(()) })
    }

    fn delete<'a>(&'a self, item_id: &'a str) -> BoxFut<'a, Result<(), String>> {
        Box::pin(async move {
            let mut docs = self
                .docs
                .lock()
                .map_err(|_| "store lock poisoned".to_owned())?;
            let _ = docs.remove(item_id);
            Ok(())
        })
    }

    fn access<'a>(
        &'a self,
        item_id: &'a str,
        user: &'a str,
    ) -> BoxFut<'a, Result<Option<Permission>, String>> {
        Box::pin(async move {
            let docs = self
                .docs
                .lock()
                .map_err(|_| "store lock poisoned".to_owned())?;
            let Some(row) = docs.get(item_id) else {
                return Ok(None);
            };
            if row.owner == user {
                return Ok(Some(Permission::Owner));
            }
            let grants = self
                .grants
                .lock()
                .map_err(|_| "store lock poisoned".to_owned())?;
            let best = grants
                .iter()
                .filter(|g| grant_covers(g, row, item_id, user))
                .filter_map(|g| Permission::parse(&g.permission))
                .max();
            Ok(best)
        })
    }

    fn create_grant<'a>(&'a self, grant: &'a NewGrant) -> BoxFut<'a, Result<GrantRow, String>> {
        Box::pin(async move {
            let id = {
                let mut next = self
                    .next_grant
                    .lock()
                    .map_err(|_| "store lock poisoned".to_owned())?;
                *next += 1;
                format!("grant-{}", *next)
            };
            let row = GrantRow {
                id,
                owner: grant.owner.clone(),
                scope: grant.scope.clone(),
                target_id: grant.target_id.clone(),
                grantee_user: Some(grant.grantee_user.clone()),
                permission: grant.permission.as_str().to_owned(),
                expires_at: grant.expires_at.clone(),
                revoked_at: None,
            };
            let mut grants = self
                .grants
                .lock()
                .map_err(|_| "store lock poisoned".to_owned())?;
            grants.push(row.clone());
            Ok(row)
        })
    }

    fn list_grants<'a>(
        &'a self,
        owner: &'a str,
        target_id: Option<&'a str>,
    ) -> BoxFut<'a, Result<Vec<GrantRow>, String>> {
        Box::pin(async move {
            let grants = self
                .grants
                .lock()
                .map_err(|_| "store lock poisoned".to_owned())?;
            let found: Vec<GrantRow> = grants
                .iter()
                .rev()
                .filter(|g| {
                    g.owner == owner
                        && g.revoked_at.is_none()
                        && target_id.is_none_or(|t| g.target_id == t)
                })
                .cloned()
                .collect();
            Ok(found)
        })
    }

    fn revoke_grant<'a>(
        &'a self,
        owner: &'a str,
        id: &'a str,
    ) -> BoxFut<'a, Result<Option<String>, String>> {
        Box::pin(async move {
            let mut grants = self
                .grants
                .lock()
                .map_err(|_| "store lock poisoned".to_owned())?;
            let found = grants.iter_mut().find(|g| g.id == id && g.owner == owner);
            Ok(found.map(|g| {
                g.revoked_at = Some("revoked".to_owned());
                g.target_id.clone()
            }))
        })
    }
}

/// The PostgREST spelling of `bytes`: `\x` then lowercase hex.
#[must_use]
pub fn bytea_hex(bytes: &[u8]) -> String {
    let mut out = String::from("\\x");
    out.extend(bytes.iter().map(|byte| format!("{byte:02x}")));
    out
}

/// Parses the PostgREST spelling of bytea; `None` for a missing prefix, odd length or non-hex text.
#[must_use]
pub fn bytea_from_hex(text: &str) -> Option<Vec<u8>> {
    let hex = text.strip_prefix("\\x")?;
    if hex.len() % 2 == 1 {
        return None;
    }
    hex.as_bytes()
        .chunks(2)
        .map(|pair| {
            if !pair.iter().all(u8::is_ascii_hexdigit) {
                return None;
            }
            let digits = std::str::from_utf8(pair).ok()?;
            u8::from_str_radix(digits, 16).ok()
        })
        .collect()
}

/// Columns read for a document row.
const DOC_COLUMNS: &str =
    "item_id,owner,kind,project_id,workspace_id,epoch,format_version,state,status";

/// The shared-document store on the OCI PostgREST, as the service role.
pub struct PgStore {
    client: reqwest::Client,
    data_url: String,
    service_key: String,
}

impl PgStore {
    /// A store that calls PostgREST at `data_url` with the service key.
    #[must_use]
    pub fn new(client: reqwest::Client, data_url: String, service_key: String) -> Self {
        Self {
            client,
            data_url,
            service_key,
        }
    }

    /// Calls as the service role: the key is both the `apikey` and the bearer.
    fn db(&self) -> UserDb<'_> {
        UserDb::new(
            &self.client,
            &self.data_url,
            &self.service_key,
            &self.service_key,
        )
    }
}

/// Builds a document row from a `shared_docs` JSON row.
fn parse_doc(row: &Value) -> Result<DocRow, String> {
    Ok(DocRow {
        item_id: text_field(row, "item_id")?,
        owner: text_field(row, "owner")?,
        kind: text_field(row, "kind")?,
        project_id: opt_text_field(row, "project_id"),
        workspace_id: opt_text_field(row, "workspace_id"),
        epoch: row
            .get("epoch")
            .and_then(Value::as_i64)
            .ok_or_else(|| "shared_docs row: bad epoch".to_owned())?,
        format_version: row
            .get("format_version")
            .and_then(Value::as_i64)
            .ok_or_else(|| "shared_docs row: bad format_version".to_owned())?,
        state: row
            .get("state")
            .and_then(Value::as_str)
            .and_then(bytea_from_hex)
            .ok_or_else(|| "shared_docs row: bad state".to_owned())?,
        status: row
            .get("status")
            .and_then(Value::as_str)
            .and_then(DocStatus::parse)
            .ok_or_else(|| "shared_docs row: bad status".to_owned())?,
    })
}

/// A required text column.
fn text_field(row: &Value, key: &str) -> Result<String, String> {
    row.get(key)
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| format!("shared_docs row: bad {key}"))
}

/// An optional text column (`null` or missing is `None`).
fn opt_text_field(row: &Value, key: &str) -> Option<String> {
    row.get(key).and_then(Value::as_str).map(str::to_owned)
}

/// The JSON body for inserting `row`, with state as bytea hex.
fn doc_json(row: &DocRow) -> Value {
    json!({
        "item_id": row.item_id,
        "owner": row.owner,
        "kind": row.kind,
        "project_id": row.project_id,
        "workspace_id": row.workspace_id,
        "epoch": row.epoch,
        "format_version": row.format_version,
        "state": bytea_hex(&row.state),
        "status": row.status.as_str(),
    })
}

impl SharedDocStore for PgStore {
    fn load<'a>(&'a self, item_id: &'a str) -> BoxFut<'a, Result<Option<DocRow>, String>> {
        Box::pin(async move {
            let query = [("select", DOC_COLUMNS.to_owned()), ("item_id", eq(item_id))];
            let rows = self
                .db()
                .select("shared_docs", &query)
                .await
                .map_err(|err| err.message)?;
            let first = rows.first().map(parse_doc).transpose()?;
            Ok(first)
        })
    }

    fn seed<'a>(&'a self, row: &'a DocRow) -> BoxFut<'a, Result<(), String>> {
        Box::pin(async move {
            self.db()
                .insert_ignore("shared_docs", &doc_json(row), "item_id")
                .await
                .map_err(|err| err.message)
        })
    }

    fn save_state<'a>(
        &'a self,
        item_id: &'a str,
        epoch: i64,
        state: &'a [u8],
    ) -> BoxFut<'a, Result<(), String>> {
        Box::pin(async move {
            let query = [("item_id", eq(item_id)), ("epoch", eq(&epoch.to_string()))];
            let patch = json!({ "state": bytea_hex(state) });
            self.db()
                .update("shared_docs", &query, &patch)
                .await
                .map_err(|err| err.message)
        })
    }

    fn replace_state<'a>(
        &'a self,
        item_id: &'a str,
        kind: &'a str,
        state: &'a [u8],
    ) -> BoxFut<'a, Result<i64, String>> {
        Box::pin(async move {
            let args = json!({
                "p_item_id": item_id,
                "p_kind": kind,
                "p_state": bytea_hex(state),
            });
            let reply = self
                .db()
                .rpc("shared_doc_restore", &args)
                .await
                .map_err(|err| err.message)?;
            reply
                .as_i64()
                .ok_or_else(|| "shared_doc_restore: unexpected reply".to_owned())
        })
    }

    fn set_status<'a>(
        &'a self,
        item_id: &'a str,
        status: DocStatus,
    ) -> BoxFut<'a, Result<(), String>> {
        Box::pin(async move {
            let query = [("item_id", eq(item_id))];
            let patch = json!({ "status": status.as_str() });
            self.db()
                .update("shared_docs", &query, &patch)
                .await
                .map_err(|err| err.message)
        })
    }

    fn set_writer<'a>(
        &'a self,
        item_id: &'a str,
        device: Option<&'a str>,
        until_ms: Option<i64>,
    ) -> BoxFut<'a, Result<(), String>> {
        Box::pin(async move {
            let query = [("item_id", eq(item_id))];
            let patch = json!({
                "writer_device": device,
                "writer_lease_until": until_ms.map(format_instant),
            });
            self.db()
                .update("shared_docs", &query, &patch)
                .await
                .map_err(|err| err.message)
        })
    }

    fn delete<'a>(&'a self, item_id: &'a str) -> BoxFut<'a, Result<(), String>> {
        Box::pin(async move {
            let query = [("item_id", eq(item_id))];
            self.db()
                .delete("shared_docs", &query)
                .await
                .map_err(|err| err.message)
        })
    }

    fn access<'a>(
        &'a self,
        item_id: &'a str,
        user: &'a str,
    ) -> BoxFut<'a, Result<Option<Permission>, String>> {
        Box::pin(async move {
            let args = json!({ "p_item_id": item_id, "p_user": user });
            let reply = self
                .db()
                .rpc("shared_doc_access", &args)
                .await
                .map_err(|err| err.message)?;
            match reply {
                Value::Null => Ok(None),
                Value::String(text) => Ok(Permission::parse(&text)),
                _ => Err("shared_doc_access: unexpected reply".to_owned()),
            }
        })
    }

    fn create_grant<'a>(&'a self, grant: &'a NewGrant) -> BoxFut<'a, Result<GrantRow, String>> {
        Box::pin(async move {
            let body = json!({
                "owner": grant.owner,
                "scope": grant.scope,
                "target_id": grant.target_id,
                "grantee_user": grant.grantee_user,
                "permission": grant.permission.as_str(),
                "expires_at": grant.expires_at,
            });
            let rows = self
                .db()
                .insert_returning("grants", &body, &[])
                .await
                .map_err(|err| err.message)?;
            let first = rows
                .into_iter()
                .next()
                .ok_or_else(|| "grants insert returned no row".to_owned())?;
            serde_json::from_value::<GrantRow>(first).map_err(|err| err.to_string())
        })
    }

    fn list_grants<'a>(
        &'a self,
        owner: &'a str,
        target_id: Option<&'a str>,
    ) -> BoxFut<'a, Result<Vec<GrantRow>, String>> {
        Box::pin(async move {
            let mut query = vec![
                ("owner", eq(owner)),
                ("revoked_at", "is.null".to_owned()),
                ("order", "created_at.desc".to_owned()),
            ];
            if let Some(target) = target_id {
                query.push(("target_id", eq(target)));
            }
            let rows = self
                .db()
                .select("grants", &query)
                .await
                .map_err(|err| err.message)?;
            rows.into_iter()
                .map(|row| serde_json::from_value::<GrantRow>(row).map_err(|err| err.to_string()))
                .collect::<Result<Vec<GrantRow>, String>>()
        })
    }

    fn revoke_grant<'a>(
        &'a self,
        owner: &'a str,
        id: &'a str,
    ) -> BoxFut<'a, Result<Option<String>, String>> {
        Box::pin(async move {
            let args = json!({ "p_id": id, "p_owner": owner });
            let reply = self
                .db()
                .rpc("revoke_grant", &args)
                .await
                .map_err(|err| err.message)?;
            match reply {
                Value::Null => Ok(None),
                Value::String(target) => Ok(Some(target)),
                _ => Err("revoke_grant: unexpected reply".to_owned()),
            }
        })
    }
}
