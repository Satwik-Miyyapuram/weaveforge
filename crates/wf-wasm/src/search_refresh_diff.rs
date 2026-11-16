//! Partial-refresh planning for the search index (wf-core `refresh_diff`). A
//! document is re-added only when it is new, changed, or not provably
//! unchanged. Its print is `JSON.stringify(doc)`, so Rust compares opaque strings.

use js_sys::{Array, JSON, Map, Reflect};
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::search::refresh_diff::{self, PrintEntry};

/// The generic signature wasm-bindgen cannot spell: `add` hands back the
/// caller's own documents.
#[wasm_bindgen(typescript_custom_section)]
const DIFF_REFRESH_PLAN_TS: &str = r#"
/**
 * What a partial refresh must touch, and the prints to remember after it.
 * `add` holds the fresh documents to (re)tokenise, and `remove` the held ids
 * that no longer exist.
 */
export function diffRefreshPlan<T extends { id: string }>(
  prints: ReadonlyMap<string, string>,
  held: readonly string[],
  fresh: readonly T[],
): { remove: string[]; add: T[]; prints: Map<string, string> };
"#;

/// The `id` field of a JS record, or `""` when it is not a string.
fn id_of(doc: &JsValue) -> String {
    Reflect::get(doc, &JsValue::from_str("id"))
        .ok()
        .and_then(|id| id.as_string())
        .unwrap_or_default()
}

/// [`diff_refresh`](refresh_diff::diff_refresh) as `{remove, add, prints}`: `add` holds the
/// caller's fresh documents themselves and `prints` is a `Map` from id to print.
///
/// # Errors
///
/// Fails if `prints` is not a `Map`, `held` is not an array of strings, `fresh`
/// is not an array, or a document cannot be passed to `JSON.stringify`.
#[wasm_bindgen(js_name = diffRefreshPlan, skip_typescript)]
pub fn diff_refresh_plan_js(
    prints: &Map,
    held: JsValue,
    fresh: &Array,
) -> Result<JsValue, JsValue> {
    let mut previous = Vec::new();
    prints.for_each(&mut |print, id| {
        previous.push(PrintEntry {
            id: id.as_string().unwrap_or_default(),
            print: print.as_string().unwrap_or_default(),
        });
    });
    let held: Vec<String> = serde_wasm_bindgen::from_value(held)?;
    let docs: Vec<JsValue> = fresh.iter().collect();
    let mut entries = Vec::with_capacity(docs.len());
    for doc in &docs {
        let print = JSON::stringify(doc)?.as_string().unwrap_or_default();
        entries.push(PrintEntry {
            id: id_of(doc),
            print,
        });
    }
    let diff = refresh_diff::diff_refresh(&previous, &held, &entries);

    let remove: Array = diff.remove.iter().map(|id| JsValue::from_str(id)).collect();
    let add: Array = diff
        .add
        .iter()
        .map(|&index| docs.get(index).cloned().unwrap_or(JsValue::UNDEFINED))
        .collect();
    let next = Map::new();
    for entry in &diff.prints {
        let _ = next.set(
            &JsValue::from_str(&entry.id),
            &JsValue::from_str(&entry.print),
        );
    }
    let out = js_sys::Object::new();
    let _ = Reflect::set(&out, &JsValue::from_str("remove"), &remove)?;
    let _ = Reflect::set(&out, &JsValue::from_str("add"), &add)?;
    let _ = Reflect::set(&out, &JsValue::from_str("prints"), &next)?;
    Ok(out.into())
}
