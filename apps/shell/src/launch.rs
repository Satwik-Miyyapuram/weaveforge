//! How the shell starts the local database sidecar: from the repo in development, from the bundled
//! resources in a release.

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::sidecar::{SIDECAR_MAX_LINE, SidecarConfig};

/// Longest wait for one sidecar reply. A first open runs every migration (about 3 s).
pub const CALL_TIMEOUT: Duration = Duration::from_secs(60);
/// Most sidecar calls waiting at once.
pub const MAX_IN_FLIGHT: usize = 64;
/// Longest sidecar reply line: big result sets are allowed, a runaway one kills the sidecar.
pub const MAX_REPLY_BYTES: usize = 256 * 1024 * 1024;
/// How long quitting waits for the sidecar to back up and close the database. Same as Electron's
/// `QUIT_TIMEOUT_MS` (apps/desktop/src/quit.ts): the exit backup can be hundreds of MB.
pub const SHUTDOWN_GRACE: Duration = Duration::from_secs(15);

/// Where the sidecar's code comes from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SidecarSource {
    /// A repo checkout: system `node` runs the TypeScript through tsx.
    Dev {
        /// The repo root.
        repo: PathBuf,
    },
    /// A release: the bundled `node` and `main.mjs` under `<resources>/sidecar`.
    Bundled {
        /// Tauri's resource directory.
        resources: PathBuf,
    },
}

/// What the sidecar needs to serve the local API: where artifacts live and this app's version.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApiArgs {
    /// Folder of locally stored artifacts (`<app data>/artifacts`).
    pub artifacts: PathBuf,
    /// The app version the local API reports.
    pub app_version: String,
}

/// `Dev` when `WF_SIDECAR_DEV` names the repo root (debug builds only), else `Bundled`.
#[must_use]
pub fn sidecar_source(resources: PathBuf) -> SidecarSource {
    #[cfg(debug_assertions)]
    {
        if let Some(repo) = std::env::var_os("WF_SIDECAR_DEV").filter(|d| !d.is_empty()) {
            return SidecarSource::Dev {
                repo: PathBuf::from(repo),
            };
        }
    }
    SidecarSource::Bundled { resources }
}

/// `path` without the Windows `\\?\` verbatim prefix, which node cannot load modules from.
/// Tauri's `resource_dir` has it on Windows, because it canonicalizes the exe path.
#[must_use]
pub fn without_verbatim_prefix(path: &Path) -> PathBuf {
    let Some(text) = path.to_str() else {
        return path.to_path_buf();
    };
    if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{rest}"));
    }
    text.strip_prefix(r"\\?\")
        .map_or_else(|| path.to_path_buf(), PathBuf::from)
}

/// Electron's data dir, to copy from on first start; `None` for a dev sidecar, which must never touch the installed
/// app's data. Electron's `userData` is `<appData>/WeaveForge`, and Tauri's `config_dir` is that `<appData>` on
/// every OS.
#[must_use]
pub fn electron_data_dir(source: &SidecarSource, config_dir: &Path) -> Option<PathBuf> {
    match source {
        SidecarSource::Dev { .. } => None,
        SidecarSource::Bundled { .. } => Some(config_dir.join("WeaveForge")),
    }
}

/// `Dev` runs with `--home-variant dev`: its MCP files stay in `~/.weaveforge/mcp-dev*`, never the installed app's.
/// `None` for `Bundled`.
#[must_use]
pub fn home_variant(source: &SidecarSource) -> Option<&'static str> {
    match source {
        SidecarSource::Dev { .. } => Some("dev"),
        SidecarSource::Bundled { .. } => None,
    }
}

/// The MCP bridge script the editors run.
#[must_use]
pub fn bridge_source(source: &SidecarSource) -> PathBuf {
    match source {
        SidecarSource::Dev { repo } => {
            without_verbatim_prefix(repo).join("apps/desktop/dist/weaveforge-mcp.mjs")
        }
        SidecarSource::Bundled { resources } => without_verbatim_prefix(resources)
            .join("sidecar")
            .join("weaveforge-mcp.mjs"),
    }
}

/// The sidecar command for `source`, opening the database in `data_dir` and keeping its backups in `backups_dir`.
/// Then the API args (`--artifacts`, `--bridge`, `--app-version`, and `--home-variant` for `Dev`), then
/// `migrate_from` (Electron's data dir) as `--migrate-from` last, when set.
#[must_use]
pub fn sidecar_config(
    source: &SidecarSource,
    data_dir: &Path,
    backups_dir: &Path,
    api: &ApiArgs,
    migrate_from: Option<&Path>,
) -> SidecarConfig {
    let data_dir = without_verbatim_prefix(data_dir);
    let backups_dir = without_verbatim_prefix(backups_dir);
    let migrate_from = migrate_from.map(without_verbatim_prefix);
    let (program, mut args, cwd): (PathBuf, Vec<OsString>, PathBuf) = match source {
        SidecarSource::Dev { repo } => {
            let repo = without_verbatim_prefix(repo);
            let args: Vec<OsString> = vec![
                "--import".into(),
                "tsx".into(),
                repo.join("apps/shell/sidecar/src/main.ts").into_os_string(),
                "--data-dir".into(),
                data_dir.as_os_str().to_owned(),
                "--backups".into(),
                backups_dir.as_os_str().to_owned(),
                "--migrations".into(),
                repo.join("db/migrations").into_os_string(),
                "--migrations".into(),
                repo.join("db/migrations-local").into_os_string(),
            ];
            (PathBuf::from("node"), args, repo)
        }
        SidecarSource::Bundled { resources } => {
            let dir = without_verbatim_prefix(resources).join("sidecar");
            let program = dir.join(format!("node{}", std::env::consts::EXE_SUFFIX));
            let args: Vec<OsString> = vec![
                dir.join("main.mjs").into_os_string(),
                "--data-dir".into(),
                data_dir.as_os_str().to_owned(),
                "--backups".into(),
                backups_dir.as_os_str().to_owned(),
                "--migrations".into(),
                dir.join("migrations").into_os_string(),
                "--migrations".into(),
                dir.join("migrations-local").into_os_string(),
            ];
            (program, args, dir)
        }
    };
    args.push("--artifacts".into());
    args.push(without_verbatim_prefix(&api.artifacts).into_os_string());
    args.push("--bridge".into());
    args.push(bridge_source(source).into_os_string());
    args.push("--app-version".into());
    args.push(api.app_version.clone().into());
    if let Some(variant) = home_variant(source) {
        args.push("--home-variant".into());
        args.push(variant.into());
    }
    if let Some(dir) = migrate_from {
        args.push("--migrate-from".into());
        args.push(dir.into_os_string());
    }
    SidecarConfig {
        program,
        args,
        cwd: Some(cwd),
        call_timeout: CALL_TIMEOUT,
        max_in_flight: MAX_IN_FLIGHT,
        max_request_bytes: SIDECAR_MAX_LINE,
        max_reply_bytes: MAX_REPLY_BYTES,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn api() -> ApiArgs {
        ApiArgs {
            artifacts: PathBuf::from("/data/artifacts"),
            app_version: "1.2.3".into(),
        }
    }

    #[test]
    fn dev_runs_main_ts_through_tsx() {
        let repo = PathBuf::from("repo");
        let config = sidecar_config(
            &SidecarSource::Dev { repo: repo.clone() },
            &PathBuf::from("data"),
            &PathBuf::from("backups"),
            &api(),
            None,
        );
        assert_eq!(config.program, PathBuf::from("node"));
        assert_eq!(config.cwd, Some(repo.clone()));
        let expected: Vec<OsString> = vec![
            "--import".into(),
            "tsx".into(),
            repo.join("apps/shell/sidecar/src/main.ts").into_os_string(),
            "--data-dir".into(),
            "data".into(),
            "--backups".into(),
            "backups".into(),
            "--migrations".into(),
            repo.join("db/migrations").into_os_string(),
            "--migrations".into(),
            repo.join("db/migrations-local").into_os_string(),
            "--artifacts".into(),
            "/data/artifacts".into(),
            "--bridge".into(),
            repo.join("apps/desktop/dist/weaveforge-mcp.mjs")
                .into_os_string(),
            "--app-version".into(),
            "1.2.3".into(),
            "--home-variant".into(),
            "dev".into(),
        ];
        assert_eq!(config.args, expected);
    }

    #[test]
    fn bundled_runs_main_mjs_with_bundled_node() {
        let res = PathBuf::from("res");
        let dir = res.join("sidecar");
        let config = sidecar_config(
            &SidecarSource::Bundled {
                resources: res.clone(),
            },
            &PathBuf::from("data"),
            &PathBuf::from("backups"),
            &api(),
            None,
        );
        assert_eq!(
            config.program,
            dir.join(format!("node{}", std::env::consts::EXE_SUFFIX))
        );
        assert_eq!(config.cwd, Some(dir.clone()));
        let expected: Vec<OsString> = vec![
            dir.join("main.mjs").into_os_string(),
            "--data-dir".into(),
            "data".into(),
            "--backups".into(),
            "backups".into(),
            "--migrations".into(),
            dir.join("migrations").into_os_string(),
            "--migrations".into(),
            dir.join("migrations-local").into_os_string(),
            "--artifacts".into(),
            "/data/artifacts".into(),
            "--bridge".into(),
            dir.join("weaveforge-mcp.mjs").into_os_string(),
            "--app-version".into(),
            "1.2.3".into(),
        ];
        assert_eq!(config.args, expected);
    }

    #[test]
    fn bundled_full_args_have_no_home_variant_and_migrate_from_last() {
        let res = PathBuf::from("res");
        let dir = res.join("sidecar");
        let config = sidecar_config(
            &SidecarSource::Bundled {
                resources: res.clone(),
            },
            &PathBuf::from("data"),
            &PathBuf::from("backups"),
            &api(),
            Some(Path::new("old")),
        );
        let expected: Vec<OsString> = vec![
            dir.join("main.mjs").into_os_string(),
            "--data-dir".into(),
            "data".into(),
            "--backups".into(),
            "backups".into(),
            "--migrations".into(),
            dir.join("migrations").into_os_string(),
            "--migrations".into(),
            dir.join("migrations-local").into_os_string(),
            "--artifacts".into(),
            "/data/artifacts".into(),
            "--bridge".into(),
            dir.join("weaveforge-mcp.mjs").into_os_string(),
            "--app-version".into(),
            "1.2.3".into(),
            "--migrate-from".into(),
            "old".into(),
        ];
        assert_eq!(config.args, expected);
        assert!(!config.args.iter().any(|a| a == "--home-variant"));
    }

    #[test]
    fn dev_full_args_have_home_variant_and_no_migrate_from() {
        let repo = PathBuf::from("repo");
        let config = sidecar_config(
            &SidecarSource::Dev { repo: repo.clone() },
            &PathBuf::from("data"),
            &PathBuf::from("backups"),
            &api(),
            None,
        );
        assert!(!config.args.iter().any(|a| a == "--migrate-from"));
        let tail: Vec<OsString> = vec![
            "--app-version".into(),
            "1.2.3".into(),
            "--home-variant".into(),
            "dev".into(),
        ];
        assert!(config.args.ends_with(&tail), "{:?}", config.args);
    }

    #[test]
    fn home_variant_is_dev_only() {
        assert_eq!(
            home_variant(&SidecarSource::Dev {
                repo: PathBuf::from("repo"),
            }),
            Some("dev")
        );
        assert_eq!(
            home_variant(&SidecarSource::Bundled {
                resources: PathBuf::from("res"),
            }),
            None
        );
    }

    #[test]
    fn bridge_source_per_variant() {
        assert_eq!(
            bridge_source(&SidecarSource::Dev {
                repo: PathBuf::from("repo"),
            }),
            PathBuf::from("repo").join("apps/desktop/dist/weaveforge-mcp.mjs")
        );
        assert_eq!(
            bridge_source(&SidecarSource::Bundled {
                resources: PathBuf::from("res"),
            }),
            PathBuf::from("res")
                .join("sidecar")
                .join("weaveforge-mcp.mjs")
        );
    }

    #[test]
    fn bridge_source_strips_verbatim_resources() {
        assert_eq!(
            bridge_source(&SidecarSource::Bundled {
                resources: PathBuf::from(r"\\?\C:\app"),
            }),
            PathBuf::from(r"C:\app")
                .join("sidecar")
                .join("weaveforge-mcp.mjs")
        );
    }

    #[test]
    fn artifacts_verbatim_prefix_is_stripped() {
        let api = ApiArgs {
            artifacts: PathBuf::from(r"\\?\C:\data\artifacts"),
            app_version: "1.2.3".into(),
        };
        let config = sidecar_config(
            &SidecarSource::Bundled {
                resources: PathBuf::from("res"),
            },
            &PathBuf::from("data"),
            &PathBuf::from("backups"),
            &api,
            None,
        );
        let pair: Vec<OsString> = vec!["--artifacts".into(), r"C:\data\artifacts".into()];
        assert!(
            config.args.windows(2).any(|w| w == pair.as_slice()),
            "{:?}",
            config.args
        );
    }

    #[test]
    fn bundled_migrate_from_is_last_and_unprefixed() {
        let config = sidecar_config(
            &SidecarSource::Bundled {
                resources: PathBuf::from("res"),
            },
            &PathBuf::from("data"),
            &PathBuf::from("backups"),
            &api(),
            Some(Path::new(r"\\?\C:\old")),
        );
        let tail: Vec<OsString> = vec!["--migrate-from".into(), r"C:\old".into()];
        assert!(config.args.ends_with(&tail), "{:?}", config.args);
    }

    #[test]
    fn dev_migrate_from_is_last() {
        let config = sidecar_config(
            &SidecarSource::Dev {
                repo: PathBuf::from("repo"),
            },
            &PathBuf::from("data"),
            &PathBuf::from("backups"),
            &api(),
            Some(Path::new("old")),
        );
        let tail: Vec<OsString> = vec!["--migrate-from".into(), "old".into()];
        assert!(config.args.ends_with(&tail), "{:?}", config.args);
    }

    #[test]
    fn dev_never_migrates() {
        let cfg = PathBuf::from("cfg");
        assert_eq!(
            electron_data_dir(
                &SidecarSource::Dev {
                    repo: PathBuf::from("repo")
                },
                &cfg
            ),
            None
        );
    }

    #[test]
    fn bundled_migrates_from_electron_user_data() {
        let source = SidecarSource::Bundled {
            resources: PathBuf::from("res"),
        };
        assert_eq!(
            electron_data_dir(&source, Path::new("cfg")),
            Some(PathBuf::from("cfg").join("WeaveForge"))
        );
    }

    #[test]
    fn shutdown_grace_covers_the_exit_backup() {
        // Electron's QUIT_TIMEOUT_MS (apps/desktop/src/quit.ts): the backup and the close fit inside it.
        assert_eq!(SHUTDOWN_GRACE, Duration::from_secs(15));
    }

    #[test]
    fn limits_are_the_launch_constants() {
        let sources = [
            SidecarSource::Dev {
                repo: PathBuf::from("repo"),
            },
            SidecarSource::Bundled {
                resources: PathBuf::from("res"),
            },
        ];
        for source in &sources {
            let config = sidecar_config(
                source,
                &PathBuf::from("data"),
                &PathBuf::from("backups"),
                &api(),
                None,
            );
            assert_eq!(config.call_timeout, CALL_TIMEOUT);
            assert_eq!(config.max_in_flight, MAX_IN_FLIGHT);
            assert_eq!(config.max_request_bytes, SIDECAR_MAX_LINE);
            assert_eq!(config.max_reply_bytes, MAX_REPLY_BYTES);
        }
    }

    #[test]
    fn bundled_without_dev_env() {
        if std::env::var_os("WF_SIDECAR_DEV").is_some() {
            return;
        }
        assert_eq!(
            sidecar_source(PathBuf::from("res")),
            SidecarSource::Bundled {
                resources: PathBuf::from("res"),
            }
        );
    }

    #[test]
    fn verbatim_prefix_is_dropped() {
        assert_eq!(
            without_verbatim_prefix(Path::new(r"\\?\C:\app")),
            PathBuf::from(r"C:\app")
        );
        assert_eq!(
            without_verbatim_prefix(Path::new(r"\\?\UNC\srv\share\app")),
            PathBuf::from(r"\\srv\share\app")
        );
        assert_eq!(
            without_verbatim_prefix(Path::new("res")),
            PathBuf::from("res")
        );
    }

    #[test]
    fn node_gets_no_verbatim_paths() {
        let verbatim = |p: &std::ffi::OsStr| p.to_string_lossy().starts_with(r"\\?\");
        let sources = [
            SidecarSource::Dev {
                repo: PathBuf::from(r"\\?\C:\repo"),
            },
            SidecarSource::Bundled {
                resources: PathBuf::from(r"\\?\C:\app"),
            },
        ];
        let api = ApiArgs {
            artifacts: PathBuf::from(r"\\?\C:\data\artifacts"),
            app_version: "1.2.3".into(),
        };
        for source in &sources {
            let config = sidecar_config(
                source,
                Path::new(r"\\?\C:\data"),
                Path::new(r"\\?\C:\backups"),
                &api,
                None,
            );
            assert!(!verbatim(config.program.as_os_str()));
            assert!(!config.cwd.iter().any(|c| verbatim(c.as_os_str())));
            assert!(
                !config.args.iter().any(|a| verbatim(a)),
                "{:?}",
                config.args
            );
        }
    }
}
