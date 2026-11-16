//! Where the shell finds its bundled files: in the repo in development, in the resources in a
//! release.

use std::path::{Path, PathBuf};

/// Product name of the side-by-side test build. It keeps its own data and MCP files, like Electron's.
pub const DEV_PRODUCT_NAME: &str = "WeaveForge Dev";

/// The resource folder (under Tauri's resource dir) with the migrations and the MCP bridge.
pub const APP_DIR: &str = "app";

/// Where the app's bundled files come from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AppSource {
    /// A repo checkout: migrations from `db/`, the bridge from `plugins/`.
    Dev {
        /// The repo root.
        repo: PathBuf,
    },
    /// A release: everything under `<resources>/app`.
    Bundled {
        /// Tauri's resource directory.
        resources: PathBuf,
    },
}

/// `Dev` when `WF_DEV_REPO` names the repo root (debug builds only), else `Bundled`.
#[must_use]
pub fn app_source(resources: PathBuf) -> AppSource {
    #[cfg(debug_assertions)]
    {
        if let Some(repo) = std::env::var_os("WF_DEV_REPO").filter(|d| !d.is_empty()) {
            return AppSource::Dev {
                repo: PathBuf::from(repo),
            };
        }
    }
    AppSource::Bundled { resources }
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

/// Electron's package name: the release's `userData` is `<appData>/@weaveforge/desktop`, not the product name.
const ELECTRON_PACKAGE_DIR: [&str; 2] = ["@weaveforge", "desktop"];

/// Electron's data dir, to copy from on first start; `None` for `Dev`, which must never touch the installed
/// app's data, and when no candidate holds Electron data. Tauri's `config_dir` is Electron's `<appData>` on every OS.
///
/// Candidates, first match wins: `<appData>/@weaveforge/desktop` (the package name, where the 0.9.0 release's
/// data was found), then `<appData>/<productName>`. A candidate matches when it holds `local-db` or
/// `preferences.json`. The test build (`DEV_PRODUCT_NAME`) only looks at its own product dir.
#[must_use]
pub fn electron_data_dir(
    source: &AppSource,
    product_name: &str,
    config_dir: &Path,
) -> Option<PathBuf> {
    if matches!(source, AppSource::Dev { .. }) {
        return None;
    }
    let mut candidates = Vec::new();
    if product_name != DEV_PRODUCT_NAME {
        candidates.push(
            ELECTRON_PACKAGE_DIR
                .iter()
                .fold(config_dir.to_path_buf(), |dir, part| dir.join(part)),
        );
    }
    candidates.push(config_dir.join(product_name));
    candidates
        .into_iter()
        .find(|dir| dir.join("local-db").exists() || dir.join("preferences.json").exists())
}

/// `Dev` keeps its MCP files in `~/.weaveforge/mcp-dev*`, never the installed app's. The side-by-side
/// test build (`DEV_PRODUCT_NAME`) gets the same variant. `None` otherwise.
#[must_use]
pub fn home_variant(source: &AppSource, product_name: &str) -> Option<&'static str> {
    match source {
        AppSource::Dev { .. } => Some("dev"),
        AppSource::Bundled { .. } if product_name == DEV_PRODUCT_NAME => Some("dev"),
        AppSource::Bundled { .. } => None,
    }
}

/// The MCP bridge script the editors run.
#[must_use]
pub fn bridge_source(source: &AppSource) -> PathBuf {
    match source {
        AppSource::Dev { repo } => {
            without_verbatim_prefix(repo).join("plugins/weaveforge-research/mcp-server/index.mjs")
        }
        AppSource::Bundled { resources } => without_verbatim_prefix(resources)
            .join(APP_DIR)
            .join("weaveforge-mcp.mjs"),
    }
}

/// The migration folders for `source`, in the order they run: shared first, then local-only.
#[must_use]
pub fn migration_dirs(source: &AppSource) -> Vec<PathBuf> {
    let base = match source {
        AppSource::Dev { repo } => without_verbatim_prefix(repo).join("db"),
        AppSource::Bundled { resources } => without_verbatim_prefix(resources).join(APP_DIR),
    };
    vec![base.join("migrations"), base.join("migrations-local")]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migration_dirs_per_variant() {
        let dev = AppSource::Dev {
            repo: PathBuf::from(r"\\?\C:\repo"),
        };
        assert_eq!(
            migration_dirs(&dev),
            vec![
                PathBuf::from(r"C:\repo").join("db").join("migrations"),
                PathBuf::from(r"C:\repo")
                    .join("db")
                    .join("migrations-local"),
            ]
        );
        let bundled = AppSource::Bundled {
            resources: PathBuf::from(r"\\?\C:\app-res"),
        };
        let dir = PathBuf::from(r"C:\app-res").join("app");
        assert_eq!(
            migration_dirs(&bundled),
            vec![dir.join("migrations"), dir.join("migrations-local")]
        );
    }

    #[test]
    fn home_variant_is_dev_or_dev_product() {
        let dev = AppSource::Dev {
            repo: PathBuf::from("repo"),
        };
        let bundled = AppSource::Bundled {
            resources: PathBuf::from("res"),
        };
        assert_eq!(home_variant(&dev, "WeaveForge"), Some("dev"));
        assert_eq!(home_variant(&bundled, "WeaveForge"), None);
        assert_eq!(home_variant(&bundled, DEV_PRODUCT_NAME), Some("dev"));
    }

    #[test]
    fn bridge_source_per_variant() {
        assert_eq!(
            bridge_source(&AppSource::Dev {
                repo: PathBuf::from("repo"),
            }),
            PathBuf::from("repo").join("plugins/weaveforge-research/mcp-server/index.mjs")
        );
        assert_eq!(
            bridge_source(&AppSource::Bundled {
                resources: PathBuf::from("res"),
            }),
            PathBuf::from("res").join("app").join("weaveforge-mcp.mjs")
        );
    }

    #[test]
    fn bridge_source_strips_verbatim_resources() {
        assert_eq!(
            bridge_source(&AppSource::Bundled {
                resources: PathBuf::from(r"\\?\C:\app"),
            }),
            PathBuf::from(r"C:\app")
                .join("app")
                .join("weaveforge-mcp.mjs")
        );
    }

    #[test]
    fn dev_never_migrates() {
        let dev = AppSource::Dev {
            repo: PathBuf::from("repo"),
        };
        assert_eq!(
            electron_data_dir(&dev, DEV_PRODUCT_NAME, Path::new("cfg")),
            None
        );
    }

    /// A fresh config dir under the temp dir with `files` (relative paths) created inside it.
    fn config_with(name: &str, files: &[&str]) -> PathBuf {
        let config = std::env::temp_dir().join(format!("wf-launch-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&config);
        for file in files {
            let path = config.join(file);
            let _ = std::fs::create_dir_all(path.parent().unwrap_or(&config));
            let _ = std::fs::write(&path, "x");
        }
        config
    }

    fn bundled() -> AppSource {
        AppSource::Bundled {
            resources: PathBuf::from("res"),
        }
    }

    #[test]
    fn electron_release_data_is_the_package_name_dir() {
        // Electron's userData is `<appData>/@weaveforge/desktop` (package name), not the product name.
        let config = config_with("pkg", &["@weaveforge/desktop/local-db/PG_VERSION"]);
        assert_eq!(
            electron_data_dir(&bundled(), "WeaveForge", &config),
            Some(config.join("@weaveforge").join("desktop"))
        );
    }

    #[test]
    fn electron_release_data_falls_back_to_the_product_dir() {
        let config = config_with("product", &["WeaveForge/preferences.json"]);
        assert_eq!(
            electron_data_dir(&bundled(), "WeaveForge", &config),
            Some(config.join("WeaveForge"))
        );
    }

    #[test]
    fn electron_data_none_when_no_candidate_has_data() {
        let config = config_with("none", &["WeaveForge/unrelated.txt"]);
        assert_eq!(electron_data_dir(&bundled(), "WeaveForge", &config), None);
        assert_eq!(
            electron_data_dir(&bundled(), "WeaveForge", &config.join("absent")),
            None
        );
    }

    #[test]
    fn electron_dev_build_only_reads_its_own_product_dir() {
        let config = config_with("dev", &["@weaveforge/desktop/local-db/PG_VERSION"]);
        assert_eq!(
            electron_data_dir(&bundled(), DEV_PRODUCT_NAME, &config),
            None,
            "the release's package dir must not feed the test build"
        );
        let config = config_with("dev-own", &["WeaveForge Dev/preferences.json"]);
        assert_eq!(
            electron_data_dir(&bundled(), DEV_PRODUCT_NAME, &config),
            Some(config.join("WeaveForge Dev"))
        );
    }

    #[test]
    fn bundled_without_dev_env() {
        if std::env::var_os("WF_DEV_REPO").is_some() {
            return;
        }
        assert_eq!(
            app_source(PathBuf::from("res")),
            AppSource::Bundled {
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
}
