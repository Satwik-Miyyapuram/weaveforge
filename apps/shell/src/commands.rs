//! Tauri commands for the local database, served by native Postgres (step 5.3f).

use std::sync::Arc;

use serde_json::Value;

use crate::local_pg::host::{PgEngine, PgHost};
use crate::sidecar::SidecarError;

/// The native Postgres database.
pub type NativeDb = Arc<PgHost<PgEngine>>;

/// The error every command returns. The bridge shim throws `new Error(message)`.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, specta::Type)]
pub struct ShellError {
    /// Human-readable message, shown as-is by the UI.
    pub message: String,
}

/// The local database's health, as `DesktopLocalDbState` in apps/web/src/lib/desktop/desktop-bridge.ts.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DbState {
    /// Why the database is unusable, or `None` when healthy.
    pub failure: Option<String>,
    /// The database's data directory.
    pub data_dir: String,
    /// The backup this run's database was rebuilt from, when it was.
    #[serde(default)]
    pub restored_from: Option<String>,
}

/// A JSON value as the sidecar sends it (`$bigint` / `$bytes` tagged). TypeScript sees `unknown`;
/// `serde_json::Value` cannot be exported because its numbers include i64.
pub type Json = specta_typescript::Unknown<Value>;

fn shell_error(message: impl Into<String>) -> ShellError {
    ShellError {
        message: message.into(),
    }
}

impl From<String> for ShellError {
    fn from(message: String) -> Self {
        Self { message }
    }
}

impl From<SidecarError> for ShellError {
    fn from(error: SidecarError) -> Self {
        match error {
            SidecarError::Spawn(m) => shell_error(format!("local database failed to start: {m}")),
            SidecarError::Busy => shell_error("local database is busy"),
            SidecarError::TooLarge => shell_error("local database request is too large"),
            SidecarError::Timeout => shell_error("local database timed out"),
            SidecarError::Exited => shell_error("local database stopped"),
            SidecarError::Remote(m) => shell_error(m),
        }
    }
}

/// Tauri-managed handle to the native database. A failed start is kept, so every command can report it.
pub struct LocalDb {
    native: Result<NativeDb, ShellError>,
    data_dir: String,
}

impl LocalDb {
    /// Wraps the native database, or why it could not be made.
    #[must_use]
    pub fn new(native: Result<NativeDb, String>, data_dir: String) -> Self {
        Self {
            native: native.map_err(ShellError::from),
            data_dir,
        }
    }

    fn native(&self) -> Result<&NativeDb, ShellError> {
        self.native.as_ref().map_err(Clone::clone)
    }

    /// Runs `sql` with `params` and returns the rows.
    pub async fn query(&self, sql: String, params: Vec<Value>) -> Result<Vec<Value>, ShellError> {
        self.native()?
            .query(&sql, &params)
            .await
            .map_err(ShellError::from)
    }

    /// The database's health; a database that cannot be used is reported in `failure`.
    #[must_use]
    pub fn state(&self) -> DbState {
        match &self.native {
            Ok(native) => native.state(),
            Err(e) => self.down(e.message.clone()),
        }
    }

    /// Resets the database.
    pub async fn reset(&self) -> Result<(), ShellError> {
        self.native()?.reset().await.map_err(ShellError::from)
    }

    /// Closes the native database.
    pub async fn shutdown(&self) {
        if let Ok(native) = &self.native {
            native.close().await;
        }
    }

    /// A state for when the database cannot be used.
    fn down(&self, failure: String) -> DbState {
        DbState {
            failure: Some(failure),
            data_dir: self.data_dir.clone(),
            restored_from: None,
        }
    }
}

/// Runs a SQL query on the local database.
#[tauri::command]
#[specta::specta]
pub async fn db_query(
    db: tauri::State<'_, LocalDb>,
    sql: String,
    params: Vec<Json>,
) -> Result<Vec<Json>, ShellError> {
    let params = json_params(params)?;
    let rows = db.query(sql, params).await?;
    rows.into_iter().map(json_row).collect()
}

/// Unwraps the TypeScript-facing params into plain JSON.
fn json_params(params: Vec<Json>) -> Result<Vec<Value>, ShellError> {
    params
        .into_iter()
        .map(serde_json::to_value)
        .collect::<Result<_, _>>()
        .map_err(|e| shell_error(format!("local database: bad params: {e}")))
}

/// Wraps a row for the TypeScript side.
fn json_row(row: Value) -> Result<Json, ShellError> {
    serde_json::from_value(row).map_err(|_| shell_error("local database: bad reply"))
}

/// The local-API channels the page may call, as in apps/shell/sidecar/src/channels.ts.
pub const LOCAL_API_CHANNELS: &[&str] = &[
    "weaveforge:local-api-state",
    "weaveforge:local-api-set",
    "weaveforge:local-api-token-create",
    "weaveforge:local-api-token-revoke",
    "weaveforge:mcp-connect",
    "weaveforge:mcp-disconnect",
    "weaveforge:mcp-open-client",
    "weaveforge:semantic-ranked",
];

/// Refuses a channel the page may not call, before the sidecar is touched.
fn check_channel(channel: &str) -> Result<(), ShellError> {
    if LOCAL_API_CHANNELS.contains(&channel) {
        Ok(())
    } else {
        Err(shell_error("channel not allowed"))
    }
}

/// Unwraps a sidecar `{ ok, value | message }` reply; any other reply passes through unchanged.
fn ipc_reply(reply: Value) -> Result<Value, ShellError> {
    match reply.get("ok").and_then(Value::as_bool) {
        Some(true) => Ok(reply.get("value").cloned().unwrap_or(Value::Null)),
        Some(false) => Err(shell_error(
            reply
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("local API call failed"),
        )),
        None => Ok(reply),
    }
}

/// Calls a local-API channel on the Rust local API, as `ipcRenderer.invoke` did under Electron.
#[tauri::command]
#[specta::specta]
pub async fn local_api_call(
    control: tauri::State<'_, crate::local_http::control::LocalApiControl>,
    channel: String,
    args: Vec<Json>,
) -> Result<Json, ShellError> {
    check_channel(&channel)?;
    let args = json_params(args)?;
    let reply = control.call(&channel, &args).await;
    json_row(ipc_reply(reply)?)
}

/// Reports the local database's health.
#[tauri::command]
#[specta::specta]
pub async fn db_state(db: tauri::State<'_, LocalDb>) -> Result<DbState, ShellError> {
    Ok(db.state())
}

/// Resets the local database.
#[tauri::command]
#[specta::specta]
pub async fn db_reset(db: tauri::State<'_, LocalDb>) -> Result<(), ShellError> {
    db.reset().await
}

/// The command set, shared by the app (invoke handler) and the bindings export.
#[must_use]
pub fn specta_builder() -> tauri_specta::Builder<tauri::Wry> {
    tauri_specta::Builder::<tauri::Wry>::new().commands(tauri_specta::collect_commands![
        db_query,
        db_state,
        db_reset,
        local_api_call,
        crate::local_files::local_file_read,
        crate::local_files::local_file_write,
        crate::local_files::local_file_remove,
        crate::prefs::preference_write,
        crate::secrets::secret_read,
        crate::secrets::secret_write,
        crate::secrets::secret_clear,
        crate::cmd_vault::vault_root,
        crate::cmd_vault::vault_choose,
        crate::cmd_vault::vault_read,
        crate::cmd_vault::vault_write,
        crate::cmd_vault::vault_read_bytes,
        crate::cmd_vault::vault_write_bytes,
        crate::cmd_vault::vault_list,
        crate::cmd_vault::vault_stat,
        crate::cmd_vault::vault_remove,
        crate::vault_sync::vault_sync,
        crate::vault_sync::vault_commit,
        crate::vault_sync::vault_log,
        crate::paste_commands::fetch_title,
        crate::paste_commands::fetch_image,
        crate::cmd_tools::tex_probe,
        crate::cmd_tools::tex_compile,
        crate::cmd_tools::zotero_local,
        crate::cmd_tools::update_check,
        crate::cmd_tools::app_log_report,
        crate::cmd_tools::app_log_read,
        crate::overleaf_read::overleaf_read,
        crate::overleaf_links::overleaf_sync,
        crate::mattermost::mattermost_sign_in,
        crate::overleaf_signin::overleaf_sign_in,
        crate::mattermost::mattermost_post,
        crate::cmd_ink::ink_available,
        crate::cmd_ink::ink_recognise,
        crate::cmd_ink::ink_haptics_available,
        crate::cmd_ink::ink_haptics,
        crate::embed::embed_load,
        crate::embed::embed_texts,
        crate::embed::embed_unload,
        crate::menu::commands::menu_model,
        crate::menu::commands::menu_invoke,
        crate::menu::commands::title_bar_colors,
        crate::menu::commands::window_focus
    ])
}

/// Writes the TypeScript bindings for `specta_builder()` to `path`.
pub fn export_bindings(path: &std::path::Path) -> Result<(), String> {
    specta_builder()
        .export(
            specta_typescript::Typescript::default().header(
                "// Generated from apps/shell/src/commands.rs by tauri-specta. Do not edit.\n// Regenerate: WF_UPDATE_BINDINGS=1 cargo test --test commands\n",
            ),
            path,
        )
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_mapping() {
        let msg = |e: SidecarError| ShellError::from(e).message;
        assert_eq!(
            msg(SidecarError::Spawn("x".into())),
            "local database failed to start: x"
        );
        assert_eq!(msg(SidecarError::Busy), "local database is busy");
        assert_eq!(
            msg(SidecarError::TooLarge),
            "local database request is too large"
        );
        assert_eq!(msg(SidecarError::Timeout), "local database timed out");
        assert_eq!(msg(SidecarError::Exited), "local database stopped");
        assert_eq!(msg(SidecarError::Remote("m".into())), "m");
    }

    #[test]
    fn ipc_reply_ok_with_value() {
        let reply = serde_json::json!({"ok": true, "value": [1]});
        assert_eq!(ipc_reply(reply), Ok(serde_json::json!([1])));
    }

    #[test]
    fn ipc_reply_ok_without_value_is_null() {
        let reply = serde_json::json!({"ok": true});
        assert_eq!(ipc_reply(reply), Ok(Value::Null));
    }

    #[test]
    fn ipc_reply_error_with_message() {
        let reply = serde_json::json!({"ok": false, "message": "m"});
        assert_eq!(ipc_reply(reply), Err(shell_error("m")));
    }

    #[test]
    fn ipc_reply_error_without_message() {
        let reply = serde_json::json!({"ok": false});
        assert_eq!(ipc_reply(reply), Err(shell_error("local API call failed")));
    }

    #[test]
    fn ipc_reply_null_passes_through() {
        assert_eq!(ipc_reply(Value::Null), Ok(Value::Null));
    }

    #[test]
    fn ipc_reply_object_without_ok_passes_through() {
        let reply = serde_json::json!({"value": 1});
        assert_eq!(ipc_reply(reply.clone()), Ok(reply));
    }

    #[test]
    fn ipc_reply_string_ok_passes_through() {
        let reply = serde_json::json!({"ok": "true", "value": 1});
        assert_eq!(ipc_reply(reply.clone()), Ok(reply));
    }

    #[test]
    fn check_channel_accepts_every_listed_channel() {
        for channel in LOCAL_API_CHANNELS {
            assert_eq!(check_channel(channel), Ok(()));
        }
    }

    #[test]
    fn check_channel_refuses_unlisted_channels() {
        for channel in [
            "weaveforge:vault-read",
            "",
            "ipc:weaveforge:local-api-state",
            "WEAVEFORGE:LOCAL-API-STATE",
        ] {
            assert_eq!(
                check_channel(channel),
                Err(shell_error("channel not allowed"))
            );
        }
    }

    #[test]
    fn local_api_channels_are_eight_unique() {
        assert_eq!(LOCAL_API_CHANNELS.len(), 8);
        let unique: std::collections::BTreeSet<_> = LOCAL_API_CHANNELS.iter().collect();
        assert_eq!(unique.len(), LOCAL_API_CHANNELS.len());
    }

    #[tokio::test]
    async fn a_failed_start_is_reported_by_every_command() {
        let db = LocalDb::new(Err("no postgres".to_owned()), "/d".to_owned());
        assert_eq!(
            db.query("select 1".to_owned(), Vec::new()).await,
            Err(shell_error("no postgres"))
        );
        assert_eq!(db.reset().await, Err(shell_error("no postgres")));
        let state = db.state();
        assert_eq!(state.failure.as_deref(), Some("no postgres"));
        assert_eq!(state.data_dir, "/d");
        db.shutdown().await;
    }

    #[tokio::test]
    async fn native_db_serves_query_state_and_reset() {
        let tmp = std::env::temp_dir().join(format!(
            "wf-native-route-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_or(0, |d| d.as_nanos())
        ));
        let engine = PgEngine::new(tmp.join("no-such-bin"), tmp.join("pg"), None);
        let native = Arc::new(PgHost::new(engine, Vec::new()));
        let db = LocalDb::new(Ok(native), "/d".to_owned());
        assert_eq!(db.state().failure, None);
        let error = db.query("select 1".to_owned(), Vec::new()).await;
        assert!(
            error.as_ref().is_err_and(|e| e
                .message
                .starts_with("The local database could not be opened.")),
            "{error:?}"
        );
        assert!(db.state().failure.is_some());
        assert_eq!(db.reset().await, Ok(()));
        assert_eq!(db.state().failure, None);
        db.shutdown().await;
        let _ = std::fs::remove_dir_all(&tmp);
    }
}
