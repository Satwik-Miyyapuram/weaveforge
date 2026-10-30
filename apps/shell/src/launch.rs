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
/// How long quitting waits for the sidecar to close the database.
pub const SHUTDOWN_GRACE: Duration = Duration::from_secs(5);

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

/// The sidecar command for `source`, opening the database in `data_dir`.
#[must_use]
pub fn sidecar_config(source: &SidecarSource, data_dir: &Path) -> SidecarConfig {
    let data_dir = without_verbatim_prefix(data_dir);
    let (program, args, cwd): (PathBuf, Vec<OsString>, PathBuf) = match source {
        SidecarSource::Dev { repo } => {
            let repo = without_verbatim_prefix(repo);
            let args: Vec<OsString> = vec![
                "--import".into(),
                "tsx".into(),
                repo.join("apps/shell/sidecar/src/main.ts").into_os_string(),
                "--data-dir".into(),
                data_dir.as_os_str().to_owned(),
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
                "--migrations".into(),
                dir.join("migrations").into_os_string(),
                "--migrations".into(),
                dir.join("migrations-local").into_os_string(),
            ];
            (program, args, dir)
        }
    };
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

    #[test]
    fn dev_runs_main_ts_through_tsx() {
        let repo = PathBuf::from("repo");
        let config = sidecar_config(
            &SidecarSource::Dev { repo: repo.clone() },
            &PathBuf::from("data"),
        );
        assert_eq!(config.program, PathBuf::from("node"));
        assert_eq!(config.cwd, Some(repo.clone()));
        let expected: Vec<OsString> = vec![
            "--import".into(),
            "tsx".into(),
            repo.join("apps/shell/sidecar/src/main.ts").into_os_string(),
            "--data-dir".into(),
            "data".into(),
            "--migrations".into(),
            repo.join("db/migrations").into_os_string(),
            "--migrations".into(),
            repo.join("db/migrations-local").into_os_string(),
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
            "--migrations".into(),
            dir.join("migrations").into_os_string(),
            "--migrations".into(),
            dir.join("migrations-local").into_os_string(),
        ];
        assert_eq!(config.args, expected);
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
            let config = sidecar_config(source, &PathBuf::from("data"));
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
        for source in &sources {
            let config = sidecar_config(source, Path::new(r"\\?\C:\data"));
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
