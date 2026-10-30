//! Tauri commands for the local database, served by the Node sidecar (design: phase-2-desktop.md § 2.4).

use std::time::Duration;

use serde_json::Value;

use crate::sidecar::{Sidecar, SidecarError};

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
    /// The PGlite data directory.
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

/// Tauri-managed handle to the sidecar. A failed spawn is kept, so every command can report it.
pub struct LocalDb {
    sidecar: Result<Sidecar, ShellError>,
    data_dir: String,
}

impl LocalDb {
    /// Wraps the spawn result; a spawn error is reported by every command.
    #[must_use]
    pub fn new(sidecar: Result<Sidecar, SidecarError>, data_dir: String) -> Self {
        Self {
            sidecar: sidecar.map_err(ShellError::from),
            data_dir,
        }
    }

    /// Runs `sql` with `params` and returns the rows.
    pub async fn query(&self, sql: String, params: Vec<Value>) -> Result<Vec<Value>, ShellError> {
        let sidecar = self.sidecar.as_ref().map_err(Clone::clone)?;
        let reply = sidecar
            .call("query", serde_json::json!({"sql": sql, "params": params}))
            .await
            .map_err(ShellError::from)?;
        match reply {
            Value::Array(rows) => Ok(rows),
            _ => Err(shell_error("local database: reply is not a list")),
        }
    }

    /// The database's health. Never fails; a problem is reported in `failure`.
    pub async fn state(&self) -> DbState {
        let sidecar = match &self.sidecar {
            Ok(sidecar) => sidecar,
            Err(e) => return self.down(e.message.clone()),
        };
        match sidecar.call("state", Value::Null).await {
            Err(e) => self.down(ShellError::from(e).message),
            Ok(reply) => serde_json::from_value::<DbState>(reply)
                .unwrap_or_else(|_| self.down("local database: bad state reply".to_owned())),
        }
    }

    /// Resets the database. The reset lifecycle lands in step 2.4c.
    pub async fn reset(&self) -> Result<(), ShellError> {
        Err(shell_error("reset is not supported yet"))
    }

    /// Stops the sidecar, waiting up to `grace`. Returns whether it exited cleanly.
    pub async fn shutdown(&self, grace: Duration) -> bool {
        match &self.sidecar {
            Ok(sidecar) => sidecar.shutdown(grace).await,
            Err(_) => false,
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

/// Unwraps the TypeScript-facing params into plain JSON for the sidecar.
fn json_params(params: Vec<Json>) -> Result<Vec<Value>, ShellError> {
    params
        .into_iter()
        .map(serde_json::to_value)
        .collect::<Result<_, _>>()
        .map_err(|e| shell_error(format!("local database: bad params: {e}")))
}

/// Wraps a row from the sidecar for the TypeScript side.
fn json_row(row: Value) -> Result<Json, ShellError> {
    serde_json::from_value(row).map_err(|_| shell_error("local database: bad reply"))
}

/// Reports the local database's health.
#[tauri::command]
#[specta::specta]
pub async fn db_state(db: tauri::State<'_, LocalDb>) -> Result<DbState, ShellError> {
    Ok(db.state().await)
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
        db_query, db_state, db_reset
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
}
