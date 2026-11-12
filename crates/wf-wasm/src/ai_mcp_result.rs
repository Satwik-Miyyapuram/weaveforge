//! MCP result shaping for JavaScript (wf-core `ai::mcp_result`). The JS names match
//! `packages/core/src/features/ai-assistant/domain/ai-mcp-result.ts`.

use serde::Deserialize;
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::ai::mcp_result;
use wf_core::ai::untrusted_context::UntrustedItem;

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// Length of a generated nonce.
const NONCE_LENGTH: usize = 16;
/// Characters a generated nonce draws from.
const NONCE_ALPHABET: &[u8] = b"abcdefghijklmnopqrstuvwxyz0123456789";

/// The optional `{ maxItemChars, maxResultChars, nonce }` argument of `mcpReadResult`.
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct McpReadOptions {
    #[serde(default)]
    max_item_chars: Option<f64>,
    #[serde(default)]
    max_result_chars: Option<f64>,
    #[serde(default)]
    nonce: Option<String>,
}

/// A fresh boundary marker from `Math.random`; not a secret, only unknown to earlier text.
#[allow(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    clippy::cast_precision_loss,
    reason = "Math.random() * 36 floors to an index in 0..36"
)]
fn fresh_nonce() -> String {
    (0..NONCE_LENGTH)
        .map(|_| {
            let index = (js_sys::Math::random() * NONCE_ALPHABET.len() as f64).floor() as usize;
            NONCE_ALPHABET
                .get(index)
                .map_or('0', |&byte| char::from(byte))
        })
        .collect()
}

/// [`MCP_RESULT_NOTICE`](mcp_result::MCP_RESULT_NOTICE): said to the calling agent, outside the fence.
#[wasm_bindgen(js_name = mcpResultNotice)]
#[must_use]
pub fn mcp_result_notice_js() -> String {
    mcp_result::MCP_RESULT_NOTICE.to_owned()
}

/// [`MAX_ITEM_CHARS`](mcp_result::MAX_ITEM_CHARS): characters of any single item.
#[wasm_bindgen(js_name = mcpMaxItemChars)]
#[must_use]
#[allow(clippy::cast_precision_loss, reason = "8000 is exact in f64")]
pub fn mcp_max_item_chars_js() -> f64 {
    mcp_result::MAX_ITEM_CHARS as f64
}

/// [`MAX_RESULT_CHARS`](mcp_result::MAX_RESULT_CHARS): characters of a whole result.
#[wasm_bindgen(js_name = mcpMaxResultChars)]
#[must_use]
#[allow(clippy::cast_precision_loss, reason = "32000 is exact in f64")]
pub fn mcp_max_result_chars_js() -> f64 {
    mcp_result::MAX_RESULT_CHARS as f64
}

/// [`mcp_read_result`](mcp_result::mcp_read_result), as a plain JS `McpResult` object. A missing
/// `options.nonce` is drawn from `Math.random` (16 characters of `[a-z0-9]`).
///
/// # Errors
///
/// Fails if `items` is not an array of `{ label, text }` objects or `options` has the wrong shape.
#[wasm_bindgen(js_name = mcpReadResult, unchecked_return_type = "B.McpResult")]
#[allow(
    clippy::cast_possible_truncation,
    reason = "limits are whole UTF-16 character counts"
)]
pub fn mcp_read_result_js(
    #[wasm_bindgen(unchecked_param_type = "readonly B.UntrustedItem[]")] items: JsValue,
    #[wasm_bindgen(
        unchecked_optional_param_type = "{ maxItemChars?: number; maxResultChars?: number; nonce?: string }"
    )]
    options: Option<JsValue>,
) -> JsResult<JsValue> {
    let items: Vec<UntrustedItem> = serde_wasm_bindgen::from_value(items)?;
    let options: McpReadOptions = match options {
        Some(options) => serde_wasm_bindgen::from_value(options)?,
        None => McpReadOptions::default(),
    };
    let nonce = options.nonce.unwrap_or_else(fresh_nonce);
    let result = mcp_result::mcp_read_result(
        &items,
        options.max_item_chars.map(|n| n as i64),
        options.max_result_chars.map(|n| n as i64),
        &nonce,
    );
    to_js(&result)
}
