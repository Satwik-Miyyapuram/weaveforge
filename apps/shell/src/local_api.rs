//! The shell's side of the sidecar's local API: the host that answers its asks, and the vault folder it is told about.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde_json::{Value, json};
use tauri::Manager as _;
use tauri_plugin_opener::OpenerExt as _;

use crate::app_log::{AppLog, LogLevel};
use crate::commands::LocalDb;
use crate::host::{Opener, ShellHost};
use crate::launch::without_verbatim_prefix;
use crate::prefs::Prefs;
use crate::secrets::Secrets;
use crate::sidecar::SidecarHost;
use crate::vault::VaultRoot;

/// The folder whose `.mcpb` files `open.path` may open: `<home>/.weaveforge/mcp`, or `mcp-<variant>` for a dev build.
#[must_use]
pub fn mcp_dir(home: &Path, variant: Option<&str>) -> PathBuf {
    let name = match variant {
        Some(variant) => format!("mcp-{variant}"),
        None => "mcp".to_owned(),
    };
    home.join(".weaveforge").join(name)
}

/// Opens links and files with the OS handlers, through tauri-plugin-opener.
pub struct TauriOpener(pub tauri::AppHandle);

impl Opener for TauriOpener {
    fn open_url(&self, url: &str) -> Result<(), String> {
        self.0
            .opener()
            .open_url(url, None::<&str>)
            .map_err(|e| e.to_string())
    }

    fn open_path(&self, path: &Path) -> Result<(), String> {
        let path = without_verbatim_prefix(path);
        let text = path
            .to_str()
            .ok_or_else(|| "path is not valid UTF-8".to_owned())?;
        self.0
            .opener()
            .open_path(text, None::<&str>)
            .map_err(|e| e.to_string())
    }
}

/// The host that answers the sidecar's asks, or `None` when the stores are not managed yet.
#[must_use]
pub fn shell_host(app: &tauri::AppHandle, mcp_dir: PathBuf) -> Option<Arc<dyn SidecarHost>> {
    let prefs = app.try_state::<Prefs>()?.inner().clone();
    let secrets = app.try_state::<Secrets>()?.inner().clone();
    let host: Arc<dyn SidecarHost> = Arc::new(ShellHost::new(
        Arc::new(prefs),
        Arc::new(secrets),
        Arc::new(TauriOpener(app.clone())),
        Arc::new(app.clone()),
        mcp_dir,
    ));
    Some(host)
}

/// The `vault.root` params for the sidecar: the root, or `{ "path": null }` to clear it.
#[must_use]
pub fn vault_root_params(root: Option<&VaultRoot>) -> Value {
    match root {
        Some(root) => serde_json::to_value(root).unwrap_or_else(|_| json!({"path": null})),
        None => json!({"path": null}),
    }
}

/// Tells the sidecar which vault folder is open; a failure is logged, never returned.
pub async fn forward_vault_root(app: &tauri::AppHandle, root: Option<&VaultRoot>) {
    let Some(db) = app.try_state::<LocalDb>() else {
        warn(
            app,
            "the local API did not get the workspace folder: no local database",
        );
        return;
    };
    if let Err(e) = db.call("vault.root", vault_root_params(root)).await {
        let line = format!(
            "the local API did not get the workspace folder: {}",
            e.message
        );
        warn(app, &line);
    }
}

/// Logs a `local-api` warning to the app log, or to stderr before the log is managed.
pub fn warn(app: &tauri::AppHandle, line: &str) {
    match app.try_state::<AppLog>() {
        Some(log) => log.record(LogLevel::Warn, "local-api", line, None),
        None => eprintln!("[local-api] {line}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault::RootKind;

    #[test]
    fn mcp_dir_prod_is_weaveforge_mcp() {
        let home = Path::new("home");
        assert_eq!(mcp_dir(home, None), home.join(".weaveforge").join("mcp"));
    }

    #[test]
    fn mcp_dir_dev_is_weaveforge_mcp_variant() {
        let home = Path::new("home");
        assert_eq!(
            mcp_dir(home, Some("dev")),
            home.join(".weaveforge").join("mcp-dev")
        );
    }

    #[test]
    fn vault_root_params_none_clears_path() {
        assert_eq!(vault_root_params(None), json!({"path": null}));
    }

    #[test]
    fn vault_root_params_some_carries_path_and_state() {
        let root = VaultRoot {
            path: "C:/notes".to_owned(),
            state: RootKind::Existing,
        };
        let params = vault_root_params(Some(&root));
        assert_eq!(params["path"], json!("C:/notes"));
        assert_eq!(params["state"], json!("existing"));
    }
}
