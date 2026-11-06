//! Rewrites the MCP client entries the Electron app wrote so they launch the bridge with the
//! shell's own binary. Entries that are not ours are left alone. Ported from `mcp-rewrite.ts`.

use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{Map, Value};

use super::connect::{MCP_BRIDGE_FILE, McpLaunch};

const ELECTRON_FLAG: &str = "ELECTRON_RUN_AS_NODE";
const DEFAULT_MCP_FILE: &str = "mcp.json";
const BACKUP_SUFFIX: &str = ".weaveforge.bak";

/// Which key a client config keeps its servers under.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum McpServersKey {
    /// Top-level `mcpServers` key (Cursor).
    McpServers,
    /// Top-level `servers` key (VS Code).
    Servers,
}

impl McpServersKey {
    /// The key as it appears in the config file.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::McpServers => "mcpServers",
            Self::Servers => "servers",
        }
    }
}

/// One client config file and the key its servers live under.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct McpClientConfig {
    /// Path to the config file.
    pub file: PathBuf,
    /// Key the servers live under in that file.
    pub key: McpServersKey,
}

/// How one config file ended: rewritten, already current, or left alone because it could not be rewritten.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum McpRewriteOutcome {
    /// Rewritten on disk.
    Changed,
    /// Already current, or the file is missing.
    Unchanged,
    /// Left alone because it could not be read or rewritten.
    Skipped,
}

/// Cursor's and VS Code's user MCP configs. `os` is `windows`, `macos`, or anything else (Linux).
#[must_use]
pub fn mcp_client_configs(home: &Path, os: &str, app_data: Option<&Path>) -> Vec<McpClientConfig> {
    let vscode_dir = match os {
        "windows" => app_data
            .map_or_else(|| home.join("AppData").join("Roaming"), Path::to_path_buf)
            .join("Code")
            .join("User"),
        "macos" => home
            .join("Library")
            .join("Application Support")
            .join("Code")
            .join("User"),
        _ => home.join(".config").join("Code").join("User"),
    };
    vec![
        McpClientConfig {
            file: home.join(".cursor").join("mcp.json"),
            key: McpServersKey::McpServers,
        },
        McpClientConfig {
            file: vscode_dir.join("mcp.json"),
            key: McpServersKey::Servers,
        },
    ]
}

/// The last non-empty path segment, split on either separator so Windows paths parse on any host.
fn last_segment(path: &str) -> Option<&str> {
    path.rsplit(['/', '\\']).find(|segment| !segment.is_empty())
}

/// True for an entry that launches the bridge: its first arg ends in the bridge file name.
///
/// The Electron-era `ELECTRON_RUN_AS_NODE` flag is not required, so entries the sidecar wrote move too.
#[must_use]
pub fn is_bridge_entry(entry: &Value) -> bool {
    entry
        .get("args")
        .and_then(Value::as_array)
        .and_then(|args| args.first())
        .and_then(Value::as_str)
        .and_then(last_segment)
        == Some(MCP_BRIDGE_FILE)
}

/// The MCP file a launch env points at, by basename; `mcp.json` when none is set.
#[must_use]
pub fn mcp_file_of(env: Option<&Value>) -> String {
    env.and_then(|env| env.get("WEAVEFORGE_MCP_FILE"))
        .and_then(Value::as_str)
        .and_then(last_segment)
        .map_or_else(|| DEFAULT_MCP_FILE.to_owned(), str::to_owned)
}

fn launch_env_value(launch: &McpLaunch) -> Value {
    Value::Object(
        launch
            .env
            .iter()
            .map(|(key, value)| (key.clone(), Value::String(value.clone())))
            .collect(),
    )
}

/// The entry rebuilt for `launch`: old env minus the Electron flag, merged with the launch env.
fn moved_entry(entry: &Value, launch: &McpLaunch) -> Value {
    let mut moved = entry.as_object().cloned().unwrap_or_default();
    let mut env = entry
        .get("env")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let _ = env.remove(ELECTRON_FLAG);
    for (key, value) in &launch.env {
        let _ = env.insert(key.clone(), Value::String(value.clone()));
    }
    let _ = moved.insert("command".to_owned(), Value::String(launch.command.clone()));
    let _ = moved.insert(
        "args".to_owned(),
        Value::Array(launch.args.iter().cloned().map(Value::String).collect()),
    );
    let _ = moved.insert("env".to_owned(), Value::Object(env));
    Value::Object(moved)
}

/// The config with every bridge entry for this launch's MCP file moved to `launch`; `None` when nothing moved.
///
/// Keys keep their input order, as in TS (serde_json's `preserve_order` feature is on). Other
/// servers and top-level keys keep their values.
#[must_use]
pub fn rewrite_mcp_config(config: &Value, key: McpServersKey, launch: &McpLaunch) -> Option<Value> {
    let servers = config.get(key.as_str())?.as_object()?;
    let launch_file = mcp_file_of(Some(&launch_env_value(launch)));
    let mut next = Map::new();
    let mut changed = false;
    for (name, entry) in servers {
        if !is_bridge_entry(entry) || mcp_file_of(entry.get("env")) != launch_file {
            let _ = next.insert(name.clone(), entry.clone());
            continue;
        }
        let _ = next.insert(name.clone(), moved_entry(entry, launch));
        changed = true;
    }
    if !changed {
        return None;
    }
    let mut out = config.as_object()?.clone();
    let _ = out.insert(key.as_str().to_owned(), Value::Object(next));
    Some(Value::Object(out))
}

/// Rewrites one config file in place. A missing file is `Unchanged`; an unreadable or non-JSON file
/// (e.g. JSONC with comments) is `Skipped` and left alone.
#[must_use]
pub fn rewrite_mcp_config_file(target: &McpClientConfig, launch: &McpLaunch) -> McpRewriteOutcome {
    let file = target.file.as_path();
    let original = match fs::read_to_string(file) {
        Ok(text) => text,
        Err(error) => return outcome_for_read_error(&error),
    };
    // The config can hold other servers' API keys; the copies keep its permissions.
    let mode = match fs::metadata(file) {
        Ok(meta) => mode_bits(&meta),
        Err(error) => return outcome_for_read_error(&error),
    };
    let Ok(parsed) = serde_json::from_str::<Value>(&original) else {
        return McpRewriteOutcome::Skipped;
    };
    let Some(config) = rewrite_mcp_config(&parsed, target.key, launch) else {
        return McpRewriteOutcome::Unchanged;
    };
    let tmp = with_suffix(
        file,
        &format!(".{}.{}.tmp", std::process::id(), nanos_now()),
    );
    if write_rewrite(file, &tmp, &original, &config, mode).is_err() {
        let _ = fs::remove_file(&tmp);
        return McpRewriteOutcome::Skipped;
    }
    McpRewriteOutcome::Changed
}

/// Rewrites every client config; returns the files it changed and the ones it skipped.
#[must_use]
pub fn rewrite_mcp_client_configs(
    targets: &[McpClientConfig],
    launch: &McpLaunch,
) -> (Vec<PathBuf>, Vec<PathBuf>) {
    let mut changed = Vec::new();
    let mut skipped = Vec::new();
    for target in targets {
        match rewrite_mcp_config_file(target, launch) {
            McpRewriteOutcome::Changed => changed.push(target.file.clone()),
            McpRewriteOutcome::Skipped => skipped.push(target.file.clone()),
            McpRewriteOutcome::Unchanged => {}
        }
    }
    (changed, skipped)
}

fn outcome_for_read_error(error: &io::Error) -> McpRewriteOutcome {
    if error.kind() == io::ErrorKind::NotFound {
        McpRewriteOutcome::Unchanged
    } else {
        McpRewriteOutcome::Skipped
    }
}

fn write_rewrite(
    file: &Path,
    tmp: &Path,
    original: &str,
    config: &Value,
    mode: Option<u32>,
) -> io::Result<()> {
    let made_backup = write_backup(file, original, mode)?;
    let mut text = serde_json::to_string_pretty(config)?;
    text.push('\n');
    open_new(tmp, mode)?.write_all(text.as_bytes())?;
    set_mode_bits(tmp, mode)?;
    fs::rename(tmp, file)?;
    // The backup can hold other servers' API keys; once the rewrite reads back it is not needed.
    // One an earlier run made is not this run's to remove.
    if made_backup && reads_back(file, config) {
        let _ = fs::remove_file(with_suffix(file, BACKUP_SUFFIX));
    }
    Ok(())
}

/// Whether `file` now parses to exactly `config`.
fn reads_back(file: &Path, config: &Value) -> bool {
    fs::read_to_string(file)
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .is_some_and(|read| &read == config)
}

/// Creates a file that has `mode` from the start, so a copy of a config holding API keys
/// is never readable by others, not even briefly. Fails if the file already exists.
fn open_new(path: &Path, mode: Option<u32>) -> io::Result<fs::File> {
    let mut options = fs::OpenOptions::new();
    let _ = options.write(true).create_new(true);
    #[cfg(unix)]
    if let Some(bits) = mode {
        use std::os::unix::fs::OpenOptionsExt;
        let _ = options.mode(bits);
    }
    #[cfg(not(unix))]
    let _ = mode;
    options.open(path)
}

/// Writes the original text once; an existing backup is kept as it is. Says whether this call made it.
fn write_backup(file: &Path, original: &str, mode: Option<u32>) -> io::Result<bool> {
    let backup = with_suffix(file, BACKUP_SUFFIX);
    let mut handle = match open_new(&backup, mode) {
        Ok(handle) => handle,
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => return Ok(false),
        Err(error) => return Err(error),
    };
    if let Err(error) = handle.write_all(original.as_bytes()) {
        // Drop the partial backup this call created, so a later run writes it again.
        drop(handle);
        let _ = fs::remove_file(&backup);
        return Err(error);
    }
    set_mode_bits(&backup, mode)?;
    Ok(true)
}

fn with_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.as_os_str().to_owned();
    name.push(suffix);
    PathBuf::from(name)
}

fn nanos_now() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or_default()
}

#[cfg(unix)]
fn mode_bits(meta: &fs::Metadata) -> Option<u32> {
    use std::os::unix::fs::PermissionsExt;
    Some(meta.permissions().mode() & 0o777)
}

#[cfg(not(unix))]
fn mode_bits(_meta: &fs::Metadata) -> Option<u32> {
    None
}

#[cfg(unix)]
fn set_mode_bits(path: &Path, mode: Option<u32>) -> io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    match mode {
        Some(bits) => fs::set_permissions(path, fs::Permissions::from_mode(bits)),
        None => Ok(()),
    }
}

#[cfg(not(unix))]
fn set_mode_bits(_path: &Path, _mode: Option<u32>) -> io::Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use serde_json::json;

    use super::*;

    const BRIDGE_ARG: &str = "/home/u/.weaveforge/mcp/weaveforge-mcp.mjs";
    const DEV_FILE: &str = "/home/u/.weaveforge/mcp-dev.json";

    /// A scratch folder under the temp dir, removed on drop.
    struct Scratch(PathBuf);

    impl Scratch {
        fn new(name: &str) -> Self {
            let dir = std::env::temp_dir().join(format!(
                "wf-mcp-rw-{name}-{}-{}",
                std::process::id(),
                nanos_now()
            ));
            fs::create_dir_all(&dir).expect("create scratch dir");
            Self(dir)
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    /// A launch for the dev file when `dev` is set, or for `mcp.json` otherwise.
    fn launch(dev: bool) -> McpLaunch {
        let env = if dev {
            BTreeMap::from([("WEAVEFORGE_MCP_FILE".to_owned(), DEV_FILE.to_owned())])
        } else {
            BTreeMap::new()
        };
        McpLaunch {
            command: "/app/node".to_owned(),
            args: vec![BRIDGE_ARG.to_owned()],
            env,
        }
    }

    /// The Electron app's entry for the dev file.
    fn dev_old() -> Value {
        json!({
            "command": "C:\\Program Files\\WeaveForge\\WeaveForge.exe",
            "args": ["C:\\Users\\u\\.weaveforge\\mcp\\weaveforge-mcp.mjs"],
            "env": { "ELECTRON_RUN_AS_NODE": "1", "KEEP": "x", "WEAVEFORGE_MCP_FILE": DEV_FILE },
            "type": "stdio"
        })
    }

    /// The Electron app's entry for the prod file (no `WEAVEFORGE_MCP_FILE`).
    fn prod_old() -> Value {
        json!({
            "command": "C:\\Program Files\\WeaveForge\\WeaveForge.exe",
            "args": ["C:\\Users\\u\\.weaveforge\\mcp\\weaveforge-mcp.mjs"],
            "env": { "ELECTRON_RUN_AS_NODE": "1", "KEEP": "x" },
            "type": "stdio"
        })
    }

    fn dev_rewritten() -> Value {
        json!({
            "command": "/app/node",
            "args": [BRIDGE_ARG],
            "env": { "KEEP": "x", "WEAVEFORGE_MCP_FILE": DEV_FILE },
            "type": "stdio"
        })
    }

    fn prod_rewritten() -> Value {
        json!({ "command": "/app/node", "args": [BRIDGE_ARG], "env": { "KEEP": "x" }, "type": "stdio" })
    }

    fn cursor_key_config(file: PathBuf) -> McpClientConfig {
        McpClientConfig {
            file,
            key: McpServersKey::McpServers,
        }
    }

    #[test]
    fn client_configs_list_cursor_then_vscode_per_os() {
        let home = Path::new("/home/u");
        let cursor = McpClientConfig {
            file: home.join(".cursor").join("mcp.json"),
            key: McpServersKey::McpServers,
        };
        let vscode = |dir: PathBuf| McpClientConfig {
            file: dir.join("mcp.json"),
            key: McpServersKey::Servers,
        };

        assert_eq!(
            mcp_client_configs(home, "windows", Some(Path::new("C:/AD"))),
            vec![
                cursor.clone(),
                vscode(Path::new("C:/AD").join("Code").join("User"))
            ]
        );
        assert_eq!(
            mcp_client_configs(home, "windows", None),
            vec![
                cursor.clone(),
                vscode(
                    home.join("AppData")
                        .join("Roaming")
                        .join("Code")
                        .join("User")
                )
            ]
        );
        assert_eq!(
            mcp_client_configs(home, "macos", None),
            vec![
                cursor.clone(),
                vscode(
                    home.join("Library")
                        .join("Application Support")
                        .join("Code")
                        .join("User")
                )
            ]
        );
        assert_eq!(
            mcp_client_configs(home, "linux", None),
            vec![
                cursor,
                vscode(home.join(".config").join("Code").join("User"))
            ]
        );
    }

    #[test]
    fn bridge_entry_matches_electron_and_sidecar_entries_by_bridge_name() {
        assert!(is_bridge_entry(&prod_old()), "electron entry");
        assert!(
            is_bridge_entry(&json!({ "command": "node", "args": [BRIDGE_ARG] })),
            "sidecar node, no env"
        );
        assert!(is_bridge_entry(
            &json!({ "command": "x", "args": [BRIDGE_ARG], "env": {} })
        ));
        assert!(
            is_bridge_entry(&json!({ "command": "x", "args": ["C:\\a\\weaveforge-mcp.mjs"] })),
            "windows path"
        );

        assert!(!is_bridge_entry(&json!({ "command": "x", "args": [] })));
        assert!(!is_bridge_entry(
            &json!({ "command": "x", "args": ["/x/index.mjs"] })
        ));
        assert!(!is_bridge_entry(
            &json!({ "command": "x", "args": ["/x/weaveforge-mcp.mjs.bak"] })
        ));
        assert!(!is_bridge_entry(&json!({ "command": "x", "args": [1] })));
        assert!(!is_bridge_entry(&json!({ "command": "x" })));
        assert!(!is_bridge_entry(&Value::Null));
        assert!(!is_bridge_entry(&json!([prod_old()])));
        assert!(!is_bridge_entry(&json!("weaveforge-mcp.mjs")));
    }

    #[test]
    fn mcp_file_of_returns_the_basename_or_mcp_json() {
        assert_eq!(mcp_file_of(None), "mcp.json");
        assert_eq!(mcp_file_of(Some(&Value::Null)), "mcp.json");
        assert_eq!(mcp_file_of(Some(&json!("mcp-dev.json"))), "mcp.json");
        assert_eq!(mcp_file_of(Some(&json!({}))), "mcp.json");
        assert_eq!(
            mcp_file_of(Some(&json!({ "WEAVEFORGE_MCP_FILE": "" }))),
            "mcp.json"
        );
        assert_eq!(
            mcp_file_of(Some(&json!({ "WEAVEFORGE_MCP_FILE": 5 }))),
            "mcp.json"
        );
        assert_eq!(
            mcp_file_of(Some(&json!({ "WEAVEFORGE_MCP_FILE": "/a/mcp-dev.json" }))),
            "mcp-dev.json"
        );
    }

    #[test]
    fn rewrite_moves_our_entry_and_leaves_others_and_top_level_keys() {
        let other = json!({ "command": "npx", "args": ["x"] });
        let input =
            json!({ "mcpServers": { "wf": dev_old(), "other": other.clone() }, "theme": "dark" });

        let result = rewrite_mcp_config(&input, McpServersKey::McpServers, &launch(true));

        assert_eq!(
            result,
            Some(
                json!({ "mcpServers": { "wf": dev_rewritten(), "other": other }, "theme": "dark" })
            )
        );
    }

    #[test]
    fn rewrite_moves_a_prod_entry_on_a_prod_launch_and_leaves_a_dev_entry() {
        let input = json!({ "mcpServers": { "prod": prod_old(), "dev": dev_old() } });
        let result = rewrite_mcp_config(&input, McpServersKey::McpServers, &launch(false));
        assert_eq!(
            result,
            Some(json!({ "mcpServers": { "prod": prod_rewritten(), "dev": dev_old() } }))
        );
    }

    #[test]
    fn rewrite_moves_a_dev_entry_on_a_dev_launch_and_leaves_a_prod_entry() {
        let input = json!({ "mcpServers": { "prod": prod_old(), "dev": dev_old() } });
        let result = rewrite_mcp_config(&input, McpServersKey::McpServers, &launch(true));
        assert_eq!(
            result,
            Some(json!({ "mcpServers": { "prod": prod_old(), "dev": dev_rewritten() } }))
        );
    }

    #[test]
    fn rewrite_leaves_a_prod_entry_unchanged_on_a_dev_launch() {
        let input = json!({ "mcpServers": { "wf": prod_old() } });
        assert_eq!(
            rewrite_mcp_config(&input, McpServersKey::McpServers, &launch(true)),
            None
        );
    }

    #[test]
    fn rewrite_moves_a_sidecar_node_entry_with_no_electron_flag() {
        let sidecar = json!({ "command": "/old/node", "args": [BRIDGE_ARG], "type": "stdio" });
        let input = json!({ "mcpServers": { "wf": sidecar } });
        let result = rewrite_mcp_config(&input, McpServersKey::McpServers, &launch(false));
        assert_eq!(
            result,
            Some(json!({
                "mcpServers": {
                    "wf": { "command": "/app/node", "args": [BRIDGE_ARG], "env": {}, "type": "stdio" }
                }
            }))
        );
    }

    #[test]
    fn rewrite_is_none_when_nothing_to_rewrite() {
        let inputs = [
            Value::Null,
            json!([]),
            json!({}),
            json!({ "mcpServers": [] }),
        ];
        for input in &inputs {
            assert_eq!(
                rewrite_mcp_config(input, McpServersKey::McpServers, &launch(false)),
                None,
                "{input}"
            );
        }
    }

    #[test]
    fn rewrite_honours_the_servers_key_and_ignores_mcp_servers() {
        let input = json!({ "servers": { "wf": dev_old() }, "mcpServers": { "wf": dev_old() } });
        let result = rewrite_mcp_config(&input, McpServersKey::Servers, &launch(true));
        assert_eq!(
            result,
            Some(
                json!({ "servers": { "wf": dev_rewritten() }, "mcpServers": { "wf": dev_old() } })
            )
        );
    }

    #[test]
    fn rewrite_file_rewrites_a_real_file_and_leaves_no_tmp_file() {
        let scratch = Scratch::new("real");
        let file = scratch.0.join("mcp.json");
        fs::write(
            &file,
            json!({ "mcpServers": { "wf": dev_old() } }).to_string(),
        )
        .unwrap();

        let outcome = rewrite_mcp_config_file(&cursor_key_config(file.clone()), &launch(true));

        assert_eq!(outcome, McpRewriteOutcome::Changed);
        let text = fs::read_to_string(&file).unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(&text).unwrap(),
            json!({ "mcpServers": { "wf": dev_rewritten() } })
        );
        assert!(text.ends_with('\n'));
        let leftovers: Vec<_> = fs::read_dir(&scratch.0)
            .unwrap()
            .filter_map(|entry| {
                entry
                    .ok()
                    .map(|e| e.file_name().to_string_lossy().into_owned())
            })
            .filter(|name| name.ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty(), "{leftovers:?}");
    }

    #[cfg(unix)]
    #[test]
    fn rewrite_file_keeps_the_mode_on_the_config() {
        use std::os::unix::fs::PermissionsExt;
        for mode in [0o600_u32, 0o640] {
            let scratch = Scratch::new(&format!("mode-{mode:o}"));
            let file = scratch.0.join("mcp.json");
            fs::write(
                &file,
                json!({ "mcpServers": { "wf": dev_old() } }).to_string(),
            )
            .unwrap();
            fs::set_permissions(&file, fs::Permissions::from_mode(mode)).unwrap();

            assert_eq!(
                rewrite_mcp_config_file(&cursor_key_config(file.clone()), &launch(true)),
                McpRewriteOutcome::Changed
            );

            assert_eq!(
                fs::metadata(&file).unwrap().permissions().mode() & 0o777,
                mode
            );
        }
    }

    #[test]
    fn rewrite_file_removes_its_backup_once_the_rewrite_reads_back() {
        let scratch = Scratch::new("backup-gone");
        let file = scratch.0.join("mcp.json");
        fs::write(&file, json!({ "mcpServers": { "wf": dev_old() } }).to_string()).unwrap();

        assert_eq!(
            rewrite_mcp_config_file(&cursor_key_config(file.clone()), &launch(true)),
            McpRewriteOutcome::Changed
        );
        assert!(!with_suffix(&file, BACKUP_SUFFIX).exists());
    }

    #[test]
    fn rewrite_file_leaves_a_backup_an_earlier_run_made() {
        let scratch = Scratch::new("backup");
        let file = scratch.0.join("mcp.json");
        let backup = with_suffix(&file, BACKUP_SUFFIX);
        let first = json!({ "mcpServers": { "wf": dev_old() } }).to_string();
        fs::write(&backup, &first).unwrap();
        let second = json!({ "mcpServers": { "wf": dev_old(), "extra": dev_old() } }).to_string();
        fs::write(&file, &second).unwrap();

        assert_eq!(
            rewrite_mcp_config_file(&cursor_key_config(file.clone()), &launch(true)),
            McpRewriteOutcome::Changed
        );
        assert_eq!(fs::read_to_string(&backup).unwrap(), first);
    }

    #[test]
    fn reads_back_only_the_config_that_was_written() {
        let scratch = Scratch::new("reads-back");
        let file = scratch.0.join("mcp.json");
        let config = json!({ "mcpServers": { "wf": dev_rewritten() } });
        assert!(!reads_back(&file, &config));
        fs::write(&file, "{not json").unwrap();
        assert!(!reads_back(&file, &config));
        fs::write(&file, json!({ "mcpServers": {} }).to_string()).unwrap();
        assert!(!reads_back(&file, &config));
        fs::write(&file, config.to_string()).unwrap();
        assert!(reads_back(&file, &config));
    }

    #[test]
    fn rewrite_file_leaves_missing_invalid_and_unrelated_files_alone() {
        let scratch = Scratch::new("alone");
        let missing = scratch.0.join("missing.json");
        assert_eq!(
            rewrite_mcp_config_file(&cursor_key_config(missing.clone()), &launch(false)),
            McpRewriteOutcome::Unchanged
        );
        assert!(!missing.exists());

        let invalid = scratch.0.join("invalid.json");
        fs::write(&invalid, "{not json").unwrap();
        assert_eq!(
            rewrite_mcp_config_file(&cursor_key_config(invalid.clone()), &launch(false)),
            McpRewriteOutcome::Skipped
        );
        assert_eq!(fs::read_to_string(&invalid).unwrap(), "{not json");

        let unrelated = scratch.0.join("unrelated.json");
        let text =
            json!({ "mcpServers": { "other": { "command": "npx", "args": ["x"] } } }).to_string();
        fs::write(&unrelated, &text).unwrap();
        assert_eq!(
            rewrite_mcp_config_file(&cursor_key_config(unrelated.clone()), &launch(false)),
            McpRewriteOutcome::Unchanged
        );
        assert_eq!(fs::read_to_string(&unrelated).unwrap(), text);
        assert!(!with_suffix(&unrelated, BACKUP_SUFFIX).exists());
    }

    #[test]
    fn rewrite_file_skips_jsonc_and_leaves_it_byte_identical() {
        let scratch = Scratch::new("jsonc");
        let file = scratch.0.join("mcp.json");
        let text = format!(
            "// user config\n{{ \"servers\": {{ \"wf\": {} }} }}\n",
            dev_old()
        );
        fs::write(&file, &text).unwrap();
        let target = McpClientConfig {
            file: file.clone(),
            key: McpServersKey::Servers,
        };

        let (changed, skipped) = rewrite_mcp_client_configs(&[target], &launch(true));

        assert!(changed.is_empty());
        assert_eq!(skipped, vec![file.clone()]);
        assert_eq!(fs::read_to_string(&file).unwrap(), text);
    }

    #[test]
    fn rewrite_client_configs_reports_a_missing_file_in_neither_list() {
        let scratch = Scratch::new("missing-list");
        let missing = scratch.0.join("missing.json");
        let (changed, skipped) =
            rewrite_mcp_client_configs(&[cursor_key_config(missing.clone())], &launch(false));
        assert!(changed.is_empty());
        assert!(skipped.is_empty());
        assert!(!missing.exists());
    }

    #[test]
    fn rewrite_client_configs_returns_the_changed_files_in_order() {
        let scratch = Scratch::new("order");
        let a = scratch.0.join("a.json");
        let b = scratch.0.join("b.json");
        let c = scratch.0.join("c.json");
        fs::write(&a, json!({ "mcpServers": { "wf": dev_old() } }).to_string()).unwrap();
        fs::write(
            &b,
            json!({ "mcpServers": { "other": { "command": "npx", "args": ["x"] } } }).to_string(),
        )
        .unwrap();
        fs::write(&c, json!({ "servers": { "wf": dev_old() } }).to_string()).unwrap();
        let targets = [
            cursor_key_config(a.clone()),
            cursor_key_config(b),
            McpClientConfig {
                file: c.clone(),
                key: McpServersKey::Servers,
            },
        ];

        let (changed, skipped) = rewrite_mcp_client_configs(&targets, &launch(true));

        assert_eq!(changed, vec![a, c]);
        assert!(skipped.is_empty());
    }
}
