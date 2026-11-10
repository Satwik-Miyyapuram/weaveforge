//! MCP client config text for JavaScript (wf-core `mcp_client_config`).

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::{JsError, wasm_bindgen};
use wf_core::mcp_client_config::{self, McpLaunchLine};

/// [`claude_code_commands`](mcp_client_config::claude_code_commands).
#[wasm_bindgen(js_name = claudeCodeCommands)]
#[must_use]
pub fn claude_code_commands_js() -> String {
    mcp_client_config::claude_code_commands()
}

/// [`gemini_install`](mcp_client_config::gemini_install).
#[wasm_bindgen(js_name = geminiInstall)]
#[must_use]
pub fn gemini_install_js() -> String {
    mcp_client_config::gemini_install()
}

/// [`codex_toml`](mcp_client_config::codex_toml) for a `McpLaunchLine`.
///
/// # Errors
///
/// Fails if `launch` has the wrong shape.
#[wasm_bindgen(js_name = codexToml)]
pub fn codex_toml_js(
    #[wasm_bindgen(unchecked_param_type = "B.McpLaunchLine")] launch: JsValue,
) -> Result<String, JsError> {
    Ok(mcp_client_config::codex_toml(&read_launch(launch)?))
}

/// [`mcp_servers_json`](mcp_client_config::mcp_servers_json) for a `McpLaunchLine`.
///
/// # Errors
///
/// Fails if `launch` has the wrong shape.
#[wasm_bindgen(js_name = mcpServersJson)]
pub fn mcp_servers_json_js(
    #[wasm_bindgen(unchecked_param_type = "B.McpLaunchLine")] launch: JsValue,
) -> Result<String, JsError> {
    Ok(mcp_client_config::mcp_servers_json(&read_launch(launch)?))
}

/// [`vscode_json`](mcp_client_config::vscode_json) for a `McpLaunchLine`.
///
/// # Errors
///
/// Fails if `launch` has the wrong shape.
#[wasm_bindgen(js_name = vscodeJson)]
pub fn vscode_json_js(
    #[wasm_bindgen(unchecked_param_type = "B.McpLaunchLine")] launch: JsValue,
) -> Result<String, JsError> {
    Ok(mcp_client_config::vscode_json(&read_launch(launch)?))
}

fn read_launch(launch: JsValue) -> Result<McpLaunchLine, JsError> {
    serde_wasm_bindgen::from_value(launch).map_err(|e| JsError::new(&e.to_string()))
}
