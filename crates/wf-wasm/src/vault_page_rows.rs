//! Vault-page row mapping for JavaScript (wf-core `vault::page_row`). The TS wrapper in
//! `packages/wf-wasm/src/vault-page-rows.ts` applies the types.

use serde::de::DeserializeOwned;
use wasm_bindgen::prelude::wasm_bindgen;
use wasm_bindgen::{JsError, JsValue};
use wf_core::vault::page::VaultPage;
use wf_core::vault::page_row::{VaultPageRow, to_domain, to_row, to_summary_domain};

use super::to_js;

fn parse<T: DeserializeOwned>(value: JsValue) -> Result<T, JsError> {
    serde_wasm_bindgen::from_value(value).map_err(|error| JsError::new(&error.to_string()))
}

#[allow(clippy::needless_pass_by_value)] // `map_err` hands the error over by value.
fn js_error(error: serde_wasm_bindgen::Error) -> JsError {
    JsError::new(&error.to_string())
}

/// [`to_domain`]: a `vault_pages` row as a full page.
#[wasm_bindgen(js_name = vaultPageToDomain, unchecked_return_type = "B.VaultPage")]
pub fn vault_page_to_domain_js(
    #[wasm_bindgen(unchecked_param_type = "B.VaultPageRow")] row: JsValue,
) -> Result<JsValue, JsError> {
    let row: VaultPageRow = parse(row)?;
    to_js(&to_domain(&row)).map_err(js_error)
}

/// [`to_summary_domain`]: a `vault_pages` row as a summary page (no body, a preview).
#[wasm_bindgen(js_name = vaultPageToSummaryDomain, unchecked_return_type = "B.VaultPage")]
pub fn vault_page_to_summary_domain_js(
    #[wasm_bindgen(unchecked_param_type = "B.VaultPageRow")] row: JsValue,
) -> Result<JsValue, JsError> {
    let row: VaultPageRow = parse(row)?;
    to_js(&to_summary_domain(&row)).map_err(js_error)
}

/// [`to_row`]: a page as the `vault_pages` row it is written as.
#[wasm_bindgen(js_name = vaultPageToRow, unchecked_return_type = "B.VaultPageWriteRow")]
pub fn vault_page_to_row_js(
    #[wasm_bindgen(unchecked_param_type = "B.VaultPage")] page: JsValue,
) -> Result<JsValue, JsError> {
    let page: VaultPage = parse(page)?;
    to_js(&to_row(&page)).map_err(js_error)
}
