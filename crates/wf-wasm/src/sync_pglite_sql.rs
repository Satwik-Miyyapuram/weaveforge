//! SQL-text helpers for the local PGlite client (wf-core `sync::pglite_sql`). The JS names
//! match `packages/wf-wasm/src/wrappers-10.ts`.

use js_sys::Array;
use wasm_bindgen::prelude::{JsError, JsValue, wasm_bindgen};
use wf_core::sync::pglite_sql;

use super::to_js;

#[wasm_bindgen]
extern "C" {
    /// The global `String(value)`, which throws only when the value's own conversion does.
    #[wasm_bindgen(catch, js_name = String)]
    fn js_string(value: &JsValue) -> Result<String, JsValue>;
}

/// [`pglite_sql::pg_array`] (TS `pgArray`): the values as a Postgres array literal, each value
/// spelled as `String(value)` first.
///
/// # Errors
///
/// Rethrows what `String(value)` throws for a value that cannot be spelled.
#[wasm_bindgen(js_name = pgArray)]
pub fn pg_array_js(
    #[wasm_bindgen(unchecked_param_type = "readonly unknown[]")] values: &Array,
) -> Result<String, JsValue> {
    let values = values
        .iter()
        .map(|value| js_string(&value))
        .collect::<Result<Vec<String>, JsValue>>()?;
    Ok(pglite_sql::pg_array(&values))
}

/// [`pglite_sql::ident`] (TS `ident`): a trimmed, double-quoted column name.
///
/// # Errors
///
/// Returns an error for a name the local database will not accept.
#[wasm_bindgen(js_name = ident)]
pub fn ident_js(name: &str) -> Result<String, JsError> {
    pglite_sql::ident(name).map_err(|error| JsError::new(&error))
}

/// [`pglite_sql::is_literal`] (TS `isLiteral`): `null`, `true` or `false`.
///
/// # Errors
///
/// Returns an error for any other operand.
#[wasm_bindgen(js_name = isLiteral)]
pub fn is_literal_js(text: &str) -> Result<String, JsError> {
    pglite_sql::is_literal(text)
        .map(str::to_owned)
        .map_err(|error| JsError::new(&error))
}

/// [`pglite_sql::projection`] (TS `projection`): a `select` column list.
///
/// # Errors
///
/// Returns an error for a column name [`pglite_sql::ident`] refuses.
#[wasm_bindgen(js_name = projection)]
pub fn projection_js(columns: &str) -> Result<String, JsError> {
    pglite_sql::projection(columns).map_err(|error| JsError::new(&error))
}

/// [`pglite_sql::split_top_level`] (TS `splitTopLevel`): the top-level comma-separated pieces.
///
/// # Errors
///
/// Returns an error if the result cannot be converted to JS.
#[wasm_bindgen(js_name = splitTopLevel, unchecked_return_type = "string[]")]
pub fn split_top_level_js(expression: &str) -> Result<JsValue, JsError> {
    to_js(&pglite_sql::split_top_level(expression))
        .map_err(|error| JsError::new(&error.to_string()))
}
