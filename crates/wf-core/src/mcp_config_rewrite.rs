//! Rewrites the MCP client entries the Electron app wrote so they launch the bridge with the
//! Tauri app's bundled `node`. Pure port of the JSON part of `apps/shell/sidecar/src/mcp-rewrite.ts`;
//! reading and writing the client config files stays in TypeScript. Entries that are not ours are
//! left alone.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::shell_paths::join_path;

/// The bridge script's file name, as the Electron app copied it.
pub const MCP_BRIDGE_FILE: &str = "weaveforge-mcp.mjs";

/// The MCP file name when a launch or an entry names none.
const DEFAULT_MCP_FILE: &str = "mcp.json";

/// How a client config launches the bridge: the command, its args and its env.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct McpLaunch {
    /// The program to run.
    pub command: String,
    /// Its arguments.
    pub args: Vec<String>,
    /// Its environment variables.
    pub env: Map<String, Value>,
}

/// The rewritten config, and whether any entry in it changed.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct McpRewrite {
    /// Whether any entry changed.
    pub changed: bool,
    /// The config after the rewrite.
    pub config: Value,
}

/// True for an entry the Electron app wrote: run as Node, first arg the bridge script.
#[must_use]
pub fn is_electron_entry(entry: &Value) -> bool {
    let Some(object) = entry.as_object() else {
        return false;
    };
    let Some(env) = object.get("env").and_then(Value::as_object) else {
        return false;
    };
    if env.get("ELECTRON_RUN_AS_NODE").and_then(Value::as_str) != Some("1") {
        return false;
    }
    let first_arg = object
        .get("args")
        .and_then(Value::as_array)
        .and_then(|args| args.first())
        .and_then(Value::as_str);
    first_arg.is_some_and(|arg| last_segment(arg) == MCP_BRIDGE_FILE)
}

/// The MCP file name an env points at, by basename; `mcp.json` when none is set or env is not an object.
#[must_use]
pub fn mcp_file_of(env: &Value) -> String {
    mcp_file_name(env.as_object())
}

/// The config with every Electron entry for this launch's MCP file moved to `launch`; others untouched.
/// Returns the config as it came in, with `changed: false`, when nothing needs rewriting.
#[must_use]
pub fn rewrite_mcp_config(config: &Value, key: &str, launch: &McpLaunch) -> McpRewrite {
    let unchanged = McpRewrite {
        changed: false,
        config: config.clone(),
    };
    let Some(root) = config.as_object() else {
        return unchanged;
    };
    let Some(servers) = root.get(key).and_then(Value::as_object) else {
        return unchanged;
    };
    let launch_file = mcp_file_name(Some(&launch.env));
    let mut next = Map::new();
    let mut changed = false;
    for (name, entry) in servers {
        let entry_env = entry.get("env").and_then(Value::as_object);
        let ours = is_electron_entry(entry) && mcp_file_name(entry_env) == launch_file;
        if !ours {
            let _ = next.insert(name.clone(), entry.clone());
            continue;
        }
        let mut env = entry_env.cloned().unwrap_or_default();
        let _ = env.remove("ELECTRON_RUN_AS_NODE");
        for (var, value) in &launch.env {
            let _ = env.insert(var.clone(), value.clone());
        }
        let mut moved = entry.as_object().cloned().unwrap_or_default();
        let _ = moved.insert("command".to_owned(), Value::String(launch.command.clone()));
        let _ = moved.insert(
            "args".to_owned(),
            Value::Array(
                launch
                    .args
                    .iter()
                    .map(|arg| Value::String(arg.clone()))
                    .collect(),
            ),
        );
        let _ = moved.insert("env".to_owned(), Value::Object(env));
        let _ = next.insert(name.clone(), Value::Object(moved));
        changed = true;
    }
    if !changed {
        return unchanged;
    }
    let mut out = root.clone();
    let _ = out.insert(key.to_owned(), Value::Object(next));
    McpRewrite {
        changed: true,
        config: Value::Object(out),
    }
}

fn mcp_file_name(env: Option<&Map<String, Value>>) -> String {
    match env
        .and_then(|env| env.get("WEAVEFORGE_MCP_FILE"))
        .and_then(Value::as_str)
    {
        Some(file) if !file.is_empty() => basename(file).to_owned(),
        _ => DEFAULT_MCP_FILE.to_owned(),
    }
}

/// Node's `path.basename` on Windows: either separator, trailing separators ignored.
fn basename(path: &str) -> &str {
    path.trim_end_matches(['/', '\\'])
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or("")
}

/// The text after the last `/` or `\`, as the TS `split(/[\\/]/)` took it.
fn last_segment(text: &str) -> &str {
    text.rsplit(['/', '\\']).next().unwrap_or(text)
}

/// One client config file and the key its servers live under (TS `McpClientConfig`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct McpClientConfig {
    /// The config file's full path.
    pub file: String,
    /// The key the servers sit under: `mcpServers` for Cursor, `servers` for VS Code.
    pub key: String,
}

/// Cursor's and VS Code's user MCP configs for this platform (TS `mcpClientConfigs`).
///
/// `platform` is the Node `process.platform` value (`win32`, `darwin`, or anything else for Linux
/// paths). `app_data` is `%APPDATA%` on Windows; when it is absent the path falls back to
/// `<home>/AppData/Roaming`. `sep` is the platform path separator.
#[must_use]
pub fn mcp_client_configs(
    home: &str,
    platform: &str,
    app_data: Option<&str>,
    sep: &str,
) -> Vec<McpClientConfig> {
    let vscode_dir = match platform {
        "win32" => {
            let roaming = app_data.map_or_else(
                || join_path(sep, &[home, "AppData", "Roaming"]),
                str::to_string,
            );
            join_path(sep, &[&roaming, "Code", "User"])
        }
        "darwin" => join_path(
            sep,
            &[home, "Library", "Application Support", "Code", "User"],
        ),
        _ => join_path(sep, &[home, ".config", "Code", "User"]),
    };
    vec![
        McpClientConfig {
            file: join_path(sep, &[home, ".cursor", "mcp.json"]),
            key: "mcpServers".to_string(),
        },
        McpClientConfig {
            file: join_path(sep, &[&vscode_dir, "mcp.json"]),
            key: "servers".to_string(),
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn launch(mcp_file: Option<&str>) -> McpLaunch {
        let mut env = Map::new();
        let _ = env.insert("NODE_ENV".to_owned(), json!("production"));
        if let Some(file) = mcp_file {
            let _ = env.insert("WEAVEFORGE_MCP_FILE".to_owned(), json!(file));
        }
        McpLaunch {
            command: "C:/Program Files/WeaveForge/node.exe".to_owned(),
            args: vec!["C:/app/weaveforge-mcp.mjs".to_owned()],
            env,
        }
    }

    fn old_entry(mcp_file: Option<&str>) -> Value {
        let mut env = json!({ "ELECTRON_RUN_AS_NODE": "1", "KEEP": "x" });
        if let Some(file) = mcp_file {
            env["WEAVEFORGE_MCP_FILE"] = json!(file);
        }
        json!({
            "command": "C:/electron.exe",
            "args": ["C:\\old\\weaveforge-mcp.mjs"],
            "env": env,
        })
    }

    #[test]
    fn only_the_electron_bridge_entry_is_ours() {
        assert!(is_electron_entry(&old_entry(None)));
        assert!(!is_electron_entry(&json!({
            "command": "x",
            "args": ["/x/weaveforge-mcp.mjs"],
            "env": { "ELECTRON_RUN_AS_NODE": "0" },
        })));
        assert!(!is_electron_entry(&json!({
            "command": "x",
            "args": [],
            "env": { "ELECTRON_RUN_AS_NODE": "1" },
        })));
        assert!(!is_electron_entry(&json!({
            "command": "x",
            "args": ["/x/index.mjs"],
            "env": { "ELECTRON_RUN_AS_NODE": "1" },
        })));
        assert!(!is_electron_entry(&Value::Null));
        assert!(!is_electron_entry(&json!([old_entry(None)])));
        assert!(!is_electron_entry(&json!("weaveforge-mcp.mjs")));
    }

    #[test]
    fn mcp_file_of_is_the_basename_or_mcp_json() {
        assert_eq!(mcp_file_of(&Value::Null), "mcp.json");
        assert_eq!(mcp_file_of(&json!("mcp-dev.json")), "mcp.json");
        assert_eq!(mcp_file_of(&json!({})), "mcp.json");
        assert_eq!(
            mcp_file_of(&json!({ "WEAVEFORGE_MCP_FILE": "" })),
            "mcp.json"
        );
        assert_eq!(
            mcp_file_of(&json!({ "WEAVEFORGE_MCP_FILE": 5 })),
            "mcp.json"
        );
        assert_eq!(
            mcp_file_of(&json!({ "WEAVEFORGE_MCP_FILE": "/a/mcp-dev.json" })),
            "mcp-dev.json"
        );
        assert_eq!(
            mcp_file_of(&json!({ "WEAVEFORGE_MCP_FILE": "C:\\a\\mcp-dev.json" })),
            "mcp-dev.json"
        );
    }

    #[test]
    fn our_entry_moves_to_the_bundled_node_and_others_stay() {
        let config = json!({
            "mcpServers": {
                "weaveforge": old_entry(None),
                "other": { "command": "npx", "args": ["other"] },
            },
            "theme": "dark",
        });
        let result = rewrite_mcp_config(&config, "mcpServers", &launch(None));
        assert!(result.changed);
        assert_eq!(
            result.config,
            json!({
                "mcpServers": {
                    "weaveforge": {
                        "command": "C:/Program Files/WeaveForge/node.exe",
                        "args": ["C:/app/weaveforge-mcp.mjs"],
                        "env": { "KEEP": "x", "NODE_ENV": "production" },
                    },
                    "other": { "command": "npx", "args": ["other"] },
                },
                "theme": "dark",
            })
        );
    }

    #[test]
    fn a_prod_entry_is_rewritten_on_a_prod_launch_and_a_dev_entry_is_left() {
        let config = json!({
            "mcpServers": {
                "prod": old_entry(None),
                "dev": old_entry(Some("mcp-dev.json")),
            },
        });
        let result = rewrite_mcp_config(&config, "mcpServers", &launch(None));
        assert!(result.changed);
        assert_eq!(
            result.config["mcpServers"]["dev"],
            old_entry(Some("mcp-dev.json"))
        );
        assert_eq!(
            result.config["mcpServers"]["prod"]["command"],
            json!("C:/Program Files/WeaveForge/node.exe")
        );
    }

    #[test]
    fn a_prod_entry_is_left_unchanged_on_a_dev_launch() {
        let config = json!({ "mcpServers": { "prod": old_entry(None) } });
        let result = rewrite_mcp_config(&config, "mcpServers", &launch(Some("mcp-dev.json")));
        assert!(!result.changed);
        assert_eq!(result.config, config);
    }

    #[test]
    fn nothing_to_rewrite_returns_the_config_as_it_came_in() {
        let config = json!({ "mcpServers": { "other": { "command": "npx" } } });
        let result = rewrite_mcp_config(&config, "mcpServers", &launch(None));
        assert!(!result.changed);
        assert_eq!(result.config, config);
        let not_an_object = json!([1, 2]);
        assert!(!rewrite_mcp_config(&not_an_object, "mcpServers", &launch(None)).changed);
    }

    #[test]
    fn the_servers_key_is_honoured_and_mcp_servers_is_ignored() {
        let config = json!({
            "mcpServers": { "ours": old_entry(None) },
            "servers": { "ours": old_entry(None) },
        });
        let result = rewrite_mcp_config(&config, "servers", &launch(None));
        assert!(result.changed);
        assert_eq!(result.config["mcpServers"], config["mcpServers"]);
        assert_eq!(
            result.config["servers"]["ours"]["command"],
            json!("C:/Program Files/WeaveForge/node.exe")
        );
    }
}
