//! The config each AI client takes to reach WeaveForge's MCP bridge, ported from
//! `apps/web/src/features/settings/ui/mcp-client-config.ts`. Filled in with this machine's
//! launch line. Pure: no I/O.

use serde::{Deserialize, Serialize};
use serde_json::Map;

/// The GitHub repo the Claude Code and Gemini installs read from.
const REPO: &str = "Satwik-Miyyapuram/weaveforge";

/// This machine's launch line: the app's binary run as Node, so no Node install is needed.
/// Serialises in the field order `command`, `args`, `env`.
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct McpLaunchLine {
    /// The program to run.
    pub command: String,
    /// Its arguments.
    pub args: Vec<String>,
    /// Environment variables for the process. Keys keep the caller's order in the output.
    #[cfg_attr(
        feature = "specta",
        specta(type = std::collections::BTreeMap<String, String>)
    )]
    pub env: Map<String, serde_json::Value>,
}

/// The two commands that install the WeaveForge research plugin into Claude Code.
#[must_use]
pub fn claude_code_commands() -> String {
    format!(
        "claude plugin marketplace add {REPO}\nclaude plugin install weaveforge-research@weaveforge"
    )
}

/// The command that installs the WeaveForge extension into Gemini CLI.
#[must_use]
pub fn gemini_install() -> String {
    format!("gemini extensions install https://github.com/{REPO}")
}

/// The `[mcp_servers.weaveforge]` TOML table for Codex. TOML basic strings take JSON's
/// escapes, so each string is written with `serde_json` string quoting.
#[must_use]
pub fn codex_toml(launch: &McpLaunchLine) -> String {
    let args = launch
        .args
        .iter()
        .map(|arg| quote(arg))
        .collect::<Vec<_>>()
        .join(", ");
    let env = launch
        .env
        .iter()
        .map(|(key, value)| format!("{key} = {}", quote(value.as_str().unwrap_or_default())))
        .collect::<Vec<_>>()
        .join(", ");
    format!(
        "[mcp_servers.weaveforge]\ncommand = {}\nargs = [{args}]\nenv = {{ {env} }}",
        quote(&launch.command)
    )
}

/// The `mcpServers` shape Cursor, Windsurf, Cline, Zed, opencode and most others read.
#[must_use]
pub fn mcp_servers_json(launch: &McpLaunchLine) -> String {
    #[derive(Serialize)]
    struct Named<'a> {
        weaveforge: &'a McpLaunchLine,
    }
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct Doc<'a> {
        mcp_servers: Named<'a>,
    }
    pretty(&Doc {
        mcp_servers: Named { weaveforge: launch },
    })
}

/// VS Code's `.vscode/mcp.json` shape: each server is `type: "stdio"` plus the launch line.
#[must_use]
pub fn vscode_json(launch: &McpLaunchLine) -> String {
    #[derive(Serialize)]
    struct Entry<'a> {
        #[serde(rename = "type")]
        kind: &'static str,
        #[serde(flatten)]
        launch: &'a McpLaunchLine,
    }
    #[derive(Serialize)]
    struct Servers<'a> {
        weaveforge: Entry<'a>,
    }
    #[derive(Serialize)]
    struct Doc<'a> {
        servers: Servers<'a>,
    }
    pretty(&Doc {
        servers: Servers {
            weaveforge: Entry {
                kind: "stdio",
                launch,
            },
        },
    })
}

/// A JSON string literal, as `JSON.stringify` writes it.
fn quote(text: &str) -> String {
    // Serialising a string cannot fail.
    serde_json::to_string(text).unwrap_or_default()
}

/// Two-space indented JSON, as `JSON.stringify(value, null, 2)` writes it.
fn pretty<T: Serialize>(value: &T) -> String {
    // These documents hold only strings and sequences, so serialising them cannot fail.
    serde_json::to_string_pretty(value).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn launch() -> McpLaunchLine {
        let mut env = Map::new();
        let _ = env.insert("ELECTRON_RUN_AS_NODE".to_owned(), "1".into());
        let _ = env.insert(
            "WEAVEFORGE_MCP_FILE".to_owned(),
            r"C:\Users\Ada Lovelace\.weaveforge\mcp-dev.json".into(),
        );
        McpLaunchLine {
            command: r"C:\Apps\WeaveForge.exe".to_owned(),
            args: vec!["mcp.mjs".to_owned()],
            env,
        }
    }

    #[test]
    fn install_commands_name_the_repo() {
        assert_eq!(
            claude_code_commands(),
            "claude plugin marketplace add Satwik-Miyyapuram/weaveforge\n\
             claude plugin install weaveforge-research@weaveforge"
        );
        assert_eq!(
            gemini_install(),
            "gemini extensions install https://github.com/Satwik-Miyyapuram/weaveforge"
        );
    }

    #[test]
    fn codex_toml_quotes_and_keeps_env_order() {
        let toml = codex_toml(&launch());
        assert_eq!(
            toml,
            "[mcp_servers.weaveforge]\n\
             command = \"C:\\\\Apps\\\\WeaveForge.exe\"\n\
             args = [\"mcp.mjs\"]\n\
             env = { ELECTRON_RUN_AS_NODE = \"1\", WEAVEFORGE_MCP_FILE = \"C:\\\\Users\\\\Ada Lovelace\\\\.weaveforge\\\\mcp-dev.json\" }"
        );
    }

    #[test]
    fn codex_toml_with_empty_env_keeps_the_js_spacing() {
        let mut bare = launch();
        bare.env = Map::new();
        assert!(codex_toml(&bare).ends_with("env = {  }"));
    }

    #[test]
    fn mcp_servers_json_round_trips_the_launch_line() {
        let text = mcp_servers_json(&launch());
        let parsed: serde_json::Value = serde_json::from_str(&text).unwrap_or_default();
        assert_eq!(
            parsed["mcpServers"]["weaveforge"],
            serde_json::to_value(launch()).unwrap_or_default()
        );
        assert!(
            text.starts_with("{\n  \"mcpServers\": {\n    \"weaveforge\": {\n      \"command\"")
        );
    }

    #[test]
    fn vscode_json_adds_stdio_type() {
        let text = vscode_json(&launch());
        let parsed: serde_json::Value = serde_json::from_str(&text).unwrap_or_default();
        assert_eq!(parsed["servers"]["weaveforge"]["type"], "stdio");
        assert_eq!(parsed["servers"]["weaveforge"]["command"], launch().command);
        assert_eq!(parsed["servers"]["weaveforge"]["args"][0], "mcp.mjs");
    }
}
