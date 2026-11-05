//! MCP result shaping for JavaScript (wf-core `ai::mcp_result`). The JS names match
//! `packages/core/src/features/ai-assistant/domain/ai-mcp-result.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::ai::mcp_result;
use wf_core::ai::untrusted_context::UntrustedItem;

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`mcp_read_result`](mcp_result::mcp_read_result), as a plain JS `McpResult` object.
///
/// # Errors
///
/// Fails if `items` is not an array of `{ label, text }` objects.
#[wasm_bindgen(js_name = mcpReadResult)]
#[allow(
    clippy::cast_possible_truncation,
    reason = "limits are whole UTF-16 character counts"
)]
#[allow(
    clippy::needless_pass_by_value,
    reason = "wasm_bindgen takes strings by value"
)]
pub fn mcp_read_result_js(
    items: JsValue,
    max_item_chars: Option<f64>,
    max_result_chars: Option<f64>,
    nonce: String,
) -> JsResult<JsValue> {
    let items: Vec<UntrustedItem> = serde_wasm_bindgen::from_value(items)?;
    let result = mcp_result::mcp_read_result(
        &items,
        max_item_chars.map(|n| n as i64),
        max_result_chars.map(|n| n as i64),
        &nonce,
    );
    to_js(&result)
}
