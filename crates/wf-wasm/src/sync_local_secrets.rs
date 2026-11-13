//! Local device secrets SQL and row reading for JavaScript (wf-core
//! `sync::local_secrets`). The JS names are `localSecretsLoadSql`,
//! `localSecretsSaveSql` and `localSecretsJsonText`, called from
//! `apps/web/src/backend/providers/local/parts.ts`.

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::sync::local_secrets::{load_secrets_sql, save_secrets_sql, secrets_json_text};

/// [`load_secrets_sql`] for JS: the statement that reads this device's secrets row.
#[wasm_bindgen(js_name = localSecretsLoadSql)]
#[must_use]
pub fn local_secrets_load_sql_js() -> String {
    load_secrets_sql().to_owned()
}

/// [`save_secrets_sql`] for JS: the statement that writes this device's secrets row.
#[wasm_bindgen(js_name = localSecretsSaveSql)]
#[must_use]
pub fn local_secrets_save_sql_js() -> String {
    save_secrets_sql().to_owned()
}

/// [`secrets_json_text`] for JS: the secrets JSON to parse, `{}` when there is no row.
#[wasm_bindgen(js_name = localSecretsJsonText)]
#[must_use]
pub fn local_secrets_json_text_js(stored: Option<String>) -> String {
    secrets_json_text(stored.as_deref())
}
