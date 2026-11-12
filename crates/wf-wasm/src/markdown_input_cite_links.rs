//! Markdown editor cite and wikilink rules for JavaScript (wf-core `markdown_input::cite_links`).

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::markdown_input::cite_links::{self, CiteCandidate};

/// [`finished_links`](cite_links::finished_links) (TS `finishedLinks`): the target of each
/// `[[link]]` the caret has left. A negative `caret` means the editor has no focus.
#[wasm_bindgen(js_name = finishedLinks)]
#[must_use]
pub fn finished_links_js(doc: &str, caret: i32) -> Vec<String> {
    cite_links::finished_links(doc, usize::try_from(caret).ok())
}

/// [`matching_completions`](cite_links::matching_completions) (TS `filterCompletions`): the
/// indices of the completions the menu shows for `query`, at most 20.
///
/// # Errors
///
/// Fails if `items` is not an array of `{ title, label, detail? }`.
#[wasm_bindgen(js_name = filterCiteCompletions)]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn filter_cite_completions_js(
    #[wasm_bindgen(
        unchecked_param_type = "readonly { title: string; label: string; detail?: string }[]"
    )]
    items: wasm_bindgen::JsValue,
    query: &str,
) -> Result<Vec<u32>, serde_wasm_bindgen::Error> {
    let items: Vec<CiteCandidate> = serde_wasm_bindgen::from_value(items)?;
    Ok(cite_links::matching_completions(&items, query))
}
