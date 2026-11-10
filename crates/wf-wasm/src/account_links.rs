//! wasm exports for `account_links` (TS: `account-links.ts`).

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::account_links::{self, AccountLinksInput};

use super::to_js;

/// [`account_links::account_links`]: the account block's rows as `{ id, label, href?, external? }`.
///
/// # Errors
///
/// Fails if `input` is not an `AccountLinksInput`-shaped object, or the result cannot be converted to JS.
#[wasm_bindgen(js_name = accountLinks)]
pub fn account_links_js(input: JsValue) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let input: AccountLinksInput = serde_wasm_bindgen::from_value(input)?;
    to_js(&account_links::account_links(&input))
}
