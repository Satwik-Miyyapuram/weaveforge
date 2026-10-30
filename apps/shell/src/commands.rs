//! Tauri commands for the local database, served by the Node sidecar (design: phase-2-desktop.md § 2.4).

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Duration;

use serde_json::Value;

use crate::sidecar::{Sidecar, SidecarConfig, SidecarError};

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

/// Whether a sidecar reply asks for the sidecar to be restarted.
fn asks_restart(reply: &Value) -> bool {
    reply.get("restart") == Some(&Value::Bool(true))
}

/// Tauri-managed handle to the sidecar. A failed spawn is kept, so every command can report it.
pub struct LocalDb {
    sidecar: tokio::sync::RwLock<Result<Sidecar, ShellError>>,
    config: Option<SidecarConfig>,
    /// Bumped on every restart, only under the write lock: a restart asked for by a sidecar that is already
    /// gone is skipped, so concurrent callers restart once.
    generation: AtomicU64,
    /// Set by `shutdown`: a restart that was waiting must not spawn a sidecar while the app quits.
    closed: AtomicBool,
    data_dir: String,
}

impl LocalDb {
    /// Wraps the spawn result; a spawn error is reported by every command.
    #[must_use]
    pub fn new(sidecar: Result<Sidecar, SidecarError>, data_dir: String) -> Self {
        Self {
            sidecar: tokio::sync::RwLock::new(sidecar.map_err(ShellError::from)),
            config: None,
            generation: AtomicU64::new(0),
            closed: AtomicBool::new(false),
            data_dir,
        }
    }

    /// Lets the handle respawn the sidecar from `config`. Only a restartable database can finish a reset
    /// that needs a fresh sidecar.
    #[must_use]
    pub fn restartable(mut self, config: SidecarConfig) -> Self {
        self.config = Some(config);
        self
    }

    /// Runs `sql` with `params` and returns the rows.
    pub async fn query(&self, sql: String, params: Vec<Value>) -> Result<Vec<Value>, ShellError> {
        let sidecar = self.sidecar.read().await;
        let sidecar = sidecar.as_ref().map_err(Clone::clone)?;
        let reply = sidecar
            .call("query", serde_json::json!({"sql": sql, "params": params}))
            .await
            .map_err(ShellError::from)?;
        match reply {
            Value::Array(rows) => Ok(rows),
            _ => Err(shell_error("local database: reply is not a list")),
        }
    }

    /// The database's health. A database that cannot be used (spawn failed, sidecar gone, bad reply) is
    /// reported in `failure`; a transient error (busy, timeout, too large, an error reply) is returned as `Err`
    /// so the caller retries instead of showing the reset screen.
    pub async fn state(&self) -> Result<DbState, ShellError> {
        let (state, restart) = self.read_state().await?;
        let Some(asked_by) = restart else {
            return Ok(state);
        };
        // A failed restart is not transient: the state read next reports it (a failed spawn is stored).
        if self.restart(asked_by).await.is_ok() {
            // The new sidecar opens lazily. Open it now (applying the move, restoring a backup) so the state
            // says how that went; a failed open is reported in `failure`.
            let _ = self.query("select 1".to_owned(), Vec::new()).await;
        }
        self.read_state().await.map(|(state, _)| state)
    }

    /// Reads the state and, when the sidecar asks to be restarted to finish a move, its generation.
    async fn read_state(&self) -> Result<(DbState, Option<u64>), ShellError> {
        let sidecar = self.sidecar.read().await;
        let generation = self.generation.load(Ordering::Acquire);
        let sidecar = match &*sidecar {
            Ok(sidecar) => sidecar,
            Err(e) => return Ok((self.down(e.message.clone()), None)),
        };
        match sidecar.call("state", Value::Null).await {
            Err(e @ SidecarError::Exited) => {
                let failure = match sidecar.exit_reason().await {
                    Some(reason) => format!("local database stopped: {reason}"),
                    None => ShellError::from(e).message,
                };
                Ok((self.down(failure), None))
            }
            Err(e) => Err(ShellError::from(e)),
            Ok(reply) => {
                let restart = asks_restart(&reply).then_some(generation);
                let state = serde_json::from_value::<DbState>(reply)
                    .unwrap_or_else(|_| self.down("local database: bad state reply".to_owned()));
                Ok((state, restart))
            }
        }
    }

    /// Replaces the sidecar of generation `asked_by` with a fresh one from the saved config; does nothing when it
    /// was already replaced. A failed spawn is stored, as at startup.
    async fn restart(&self, asked_by: u64) -> Result<(), ShellError> {
        let Some(config) = &self.config else {
            return Err(shell_error(
                "local database: restart the app to finish the reset",
            ));
        };
        let mut sidecar = self.sidecar.write().await;
        if self.closed.load(Ordering::Acquire) {
            return Err(shell_error("local database: closed"));
        }
        if self.generation.load(Ordering::Acquire) != asked_by {
            return Ok(());
        }
        if let Ok(old) = &*sidecar {
            let _ = old.shutdown(crate::launch::SHUTDOWN_GRACE).await;
        }
        *sidecar = Sidecar::spawn(config.clone()).map_err(ShellError::from);
        let _ = self.generation.fetch_add(1, Ordering::AcqRel);
        sidecar.as_ref().map(|_| ()).map_err(Clone::clone)
    }

    /// Resets the database. A reset that can only finish in a fresh process restarts the sidecar, which then
    /// applies it; the sidecar may be restarted by this call.
    pub async fn reset(&self) -> Result<(), ShellError> {
        let (reply, generation) = {
            let sidecar = self.sidecar.read().await;
            let generation = self.generation.load(Ordering::Acquire);
            let sidecar = sidecar.as_ref().map_err(Clone::clone)?;
            let reply = sidecar
                .call("reset", Value::Null)
                .await
                .map_err(ShellError::from)?;
            (reply, generation)
        };
        if !reply.is_object() {
            return Err(shell_error("local database: bad reset reply"));
        }
        if asks_restart(&reply) {
            self.restart(generation).await?;
        }
        Ok(())
    }

    /// Stops the sidecar, waiting up to `grace`. Returns whether it exited cleanly.
    pub async fn shutdown(&self, grace: Duration) -> bool {
        self.closed.store(true, Ordering::Release);
        let sidecar = self.sidecar.read().await;
        match &*sidecar {
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
    db.state().await
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

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn no_restart_after_shutdown() {
        let fixture = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/fake-sidecar.mjs");
        let config = SidecarConfig {
            program: "node".into(),
            args: vec![fixture.into_os_string()],
            cwd: None,
            call_timeout: Duration::from_secs(5),
            max_in_flight: 8,
            max_request_bytes: 4096,
            max_reply_bytes: 1 << 20,
        };
        let db = LocalDb::new(Sidecar::spawn(config.clone()), "/d".to_owned()).restartable(config);
        assert!(db.shutdown(Duration::from_secs(5)).await);
        assert_eq!(
            db.restart(0).await,
            Err(shell_error("local database: closed"))
        );
        assert_eq!(db.generation.load(Ordering::Acquire), 0);
    }

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
