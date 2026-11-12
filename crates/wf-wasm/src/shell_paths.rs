//! Shell path naming for JavaScript (wf-core `shell_paths` and `mcp_config_rewrite::mcp_client_configs`).
//! The JS names match `apps/shell/sidecar/src/home-config.ts` and `mcp-rewrite.ts`. The separator and
//! platform come in as arguments; the file reads and writes stay in TypeScript.

use wasm_bindgen::prelude::{JsValue, wasm_bindgen};
use wf_core::mcp_config_rewrite;
use wf_core::shell_paths;

use crate::to_js;

/// [`home_config_path`](shell_paths::home_config_path): the home pointer file for a build variant.
#[wasm_bindgen(js_name = homeConfigPath)]
pub fn home_config_path_js(home: &str, variant: Option<String>, sep: &str) -> String {
    shell_paths::home_config_path(home, variant.as_deref(), sep)
}

/// [`mcp_client_configs`](mcp_config_rewrite::mcp_client_configs) as `[{ file, key }]`.
///
/// # Errors
///
/// Fails only when the result cannot be serialised to JavaScript.
#[wasm_bindgen(
    js_name = mcpClientConfigs,
    unchecked_return_type = "{ file: string; key: \"mcpServers\" | \"servers\" }[]"
)]
pub fn mcp_client_configs_js(
    home: &str,
    platform: &str,
    app_data: Option<String>,
    sep: &str,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    to_js(&mcp_config_rewrite::mcp_client_configs(
        home,
        platform,
        app_data.as_deref(),
        sep,
    ))
}
