//! Bib entry parsing for JavaScript (wf-core `report::bib_entries`). Each export wraps one
//! function; the JS name and shape match `packages/core/src/features/report/domain/parts.ts`.
//!
//! Objects cross as plain JS objects through serde. Each entry's `fields` is built here as a
//! record in source order (a repeated name keeps its first position and its last value, as
//! `Object.fromEntries` does).

use js_sys::{Array, Object, Reflect};
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::latex_section_tree::LatexSourceFile;
use wf_core::report::bib_entries::{self, BibEntry};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`parse_bib_entries`](bib_entries::parse_bib_entries) (TS `parseBibEntries`): every `.bib`
/// among `files` (others are ignored); bad entries become warnings. Each entry's `fields` is a
/// record in source order.
///
/// # Errors
///
/// Fails if `files` is not an array of `{ path, content }`.
#[wasm_bindgen(
    js_name = parseBibEntries,
    unchecked_return_type = "{ entries: (Omit<B.BibEntry, \"fields\"> & { fields: Record<string, string> })[]; warnings: B.BibWarning[] }"
)]
pub fn parse_bib_entries_js(
    #[wasm_bindgen(unchecked_param_type = "readonly B.LatexSourceFile[]")] files: JsValue,
) -> JsResult<JsValue> {
    let files: Vec<LatexSourceFile> = serde_wasm_bindgen::from_value(files)?;
    let parsed = bib_entries::parse_bib_entries(&files);
    let entries = Array::new();
    for entry in &parsed.entries {
        let _ = entries.push(&entry_to_js(entry)?);
    }
    let out = Object::new();
    set(&out, "entries", &entries)?;
    set(&out, "warnings", &to_js(&parsed.warnings)?)?;
    Ok(out.into())
}

/// One entry as `{ type, key, fields, file, line }` with `fields` a record.
fn entry_to_js(entry: &BibEntry) -> JsResult<JsValue> {
    let fields = Object::new();
    for field in &entry.fields {
        set(&fields, &field.name, &JsValue::from_str(&field.value))?;
    }
    let out = Object::new();
    set(&out, "type", &JsValue::from_str(&entry.entry_type))?;
    set(&out, "key", &JsValue::from_str(&entry.key))?;
    set(&out, "fields", &fields)?;
    set(&out, "file", &JsValue::from_str(&entry.file))?;
    set(&out, "line", &JsValue::from(entry.line))?;
    Ok(out.into())
}

/// Sets `target[key] = value`.
fn set(target: &Object, key: &str, value: &JsValue) -> JsResult<()> {
    Reflect::set(target, &JsValue::from_str(key), value)
        .map(|_| ())
        .map_err(|_| serde_wasm_bindgen::Error::new("could not set a property"))
}

/// [`parse_latex_section_tree`](wf_core::latex_section_tree::parse_latex_section_tree)
/// (TS `parseLatexSectionTree`). `entry_file` defaults to `main.tex`.
///
/// # Errors
///
/// Fails if `files` is not an array of `{ path, content }`.
#[wasm_bindgen(js_name = parseLatexSectionTree, unchecked_return_type = "B.LatexSectionTree")]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs an owned Option<String>.
pub fn parse_latex_section_tree_js(
    #[wasm_bindgen(unchecked_param_type = "readonly B.LatexSourceFile[]")] files: JsValue,
    entry_file: Option<String>,
) -> JsResult<JsValue> {
    let files: Vec<LatexSourceFile> = serde_wasm_bindgen::from_value(files)?;
    let entry = entry_file.as_deref().unwrap_or("main.tex");
    to_js(&wf_core::latex_section_tree::parse_latex_section_tree(
        &files, entry,
    ))
}
