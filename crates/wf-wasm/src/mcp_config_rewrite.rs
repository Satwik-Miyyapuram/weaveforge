//! MCP client config rewrite for JavaScript (wf-core `mcp_config_rewrite`). The JS names match
//! `apps/shell/sidecar/src/mcp-rewrite.ts`; the file reads and writes stay in TypeScript.

use serde_json::Value;
use wasm_bindgen::prelude::{JsValue, wasm_bindgen};
use wf_core::mcp_config_rewrite::{self, McpLaunch};

use crate::to_js;

/// [`is_electron_entry`](mcp_config_rewrite::is_electron_entry): an entry the Electron app wrote.
#[wasm_bindgen(js_name = isElectronMcpEntry)]
pub fn is_electron_mcp_entry_js(
    #[wasm_bindgen(unchecked_param_type = "unknown")] entry: JsValue,
) -> Result<bool, serde_wasm_bindgen::Error> {
    let entry: Value = serde_wasm_bindgen::from_value(entry)?;
    Ok(mcp_config_rewrite::is_electron_entry(&entry))
}

/// [`mcp_file_of`](mcp_config_rewrite::mcp_file_of): the MCP file name an env points at.
#[wasm_bindgen(js_name = mcpFileOf)]
pub fn mcp_file_of_js(
    #[wasm_bindgen(unchecked_param_type = "unknown")] env: JsValue,
) -> Result<String, serde_wasm_bindgen::Error> {
    let env: Value = serde_wasm_bindgen::from_value(env)?;
    Ok(mcp_config_rewrite::mcp_file_of(&env))
}

/// [`rewrite_mcp_config`](mcp_config_rewrite::rewrite_mcp_config) as `{ changed, config }`.
///
/// # Errors
///
/// Fails when `launch` is not an object with `command`, `args` and `env`.
#[wasm_bindgen(js_name = rewriteMcpConfig)]
pub fn rewrite_mcp_config_js(
    config: JsValue,
    key: &str,
    launch: JsValue,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let config: Value = serde_wasm_bindgen::from_value(config)?;
    let launch: McpLaunch = serde_wasm_bindgen::from_value(launch)?;
    to_js(&mcp_config_rewrite::rewrite_mcp_config(
        &config, key, &launch,
    ))
}
