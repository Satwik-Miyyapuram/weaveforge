//! What the Rust local API needs from the app: an opener, the database, the artifacts folder, the log.

use std::path::{Path, PathBuf};
use tauri::Manager as _;
use tauri_plugin_opener::OpenerExt as _;

use crate::app_log::{AppLog, LogLevel};
use crate::host::Opener;
use crate::launch::without_verbatim_prefix;
use crate::local_artifacts::write_local_artifact;
use crate::local_http::{BoxFuture, SaveArtifact};

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

/// Saves SDK artifacts under the app's local artifacts folder.
pub struct AppArtifacts(pub PathBuf);

impl SaveArtifact for AppArtifacts {
    fn save<'a>(
        &'a self,
        experiment_id: &'a str,
        name: &'a str,
        bytes: Vec<u8>,
    ) -> BoxFuture<'a, Result<String, String>> {
        Box::pin(async move { write_local_artifact(&self.0, experiment_id, name, &bytes) })
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
}
