//! Bib entry parsing for JavaScript (wf-core `report::bib_entries`). Each export wraps one
//! function; the JS name and shape match `packages/core/src/features/report/domain/parts.ts`.
//!
//! Objects cross as plain JS objects through serde. Entry `fields` cross as an ordered
//! `{ name, value }` list; `packages/wf-wasm/src/wrappers-8.ts` rebuilds the record.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::latex_section_tree::LatexSourceFile;
use wf_core::report::bib_entries;

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`parse_bib_entries`](bib_entries::parse_bib_entries) (TS `parseBibEntries`).
///
/// # Errors
///
/// Fails if `files` is not an array of `{ path, content }`.
#[wasm_bindgen(js_name = parseBibEntries)]
pub fn parse_bib_entries_js(files: JsValue) -> JsResult<JsValue> {
    let files: Vec<LatexSourceFile> = serde_wasm_bindgen::from_value(files)?;
    to_js(&bib_entries::parse_bib_entries(&files))
}

/// [`parse_latex_section_tree`](wf_core::latex_section_tree::parse_latex_section_tree)
/// (TS `parseLatexSectionTree`). `entry_file` defaults to `main.tex`.
///
/// # Errors
///
/// Fails if `files` is not an array of `{ path, content }`.
#[wasm_bindgen(js_name = parseLatexSectionTree)]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs an owned Option<String>.
pub fn parse_latex_section_tree_js(
    files: JsValue,
    entry_file: Option<String>,
) -> JsResult<JsValue> {
    let files: Vec<LatexSourceFile> = serde_wasm_bindgen::from_value(files)?;
    let entry = entry_file.as_deref().unwrap_or("main.tex");
    to_js(&wf_core::latex_section_tree::parse_latex_section_tree(
        &files, entry,
    ))
}
