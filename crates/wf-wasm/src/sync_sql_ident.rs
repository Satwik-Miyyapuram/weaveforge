//! Postgres identifier quoting for JavaScript (wf-core `sync::sql_ident`). The JS name matches
//! `quoteIdent` in `packages/wf-wasm/src/sync-sql-ident.ts`.

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::sync::sql_ident::quote_ident;

/// [`quote_ident`] (TS `quoteIdent`): the name in double quotes, embedded quotes doubled.
#[wasm_bindgen(js_name = quoteIdent)]
#[must_use]
pub fn quote_ident_js(name: &str) -> String {
    quote_ident(name)
}
