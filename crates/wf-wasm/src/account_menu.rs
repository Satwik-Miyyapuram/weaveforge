//! wasm exports for `account_menu` (TS: `account-menu.ts`).

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::account_menu::{self, AccountAttentionInput, InboxInput};

use super::to_js;

/// [`account_menu::inbox_links`]: the Inbox rows as `{ key, label, path, icon, badge? }`.
///
/// # Errors
///
/// Fails if `input` is not an `InboxInput`-shaped object, or the result cannot be converted to JS.
#[wasm_bindgen(js_name = inboxLinks)]
pub fn inbox_links_js(input: JsValue) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let input: InboxInput = serde_wasm_bindgen::from_value(input)?;
    to_js(&account_menu::inbox_links(&input))
}

/// [`account_menu::account_attention`]: the menu rows and the icon total as `{ rows, total }`.
///
/// # Errors
///
/// Fails if `input` is not an `AccountAttentionInput`-shaped object, or the result cannot be converted to JS.
#[wasm_bindgen(js_name = accountAttention)]
pub fn account_attention_js(input: JsValue) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let input: AccountAttentionInput = serde_wasm_bindgen::from_value(input)?;
    to_js(&account_menu::account_attention(&input))
}
