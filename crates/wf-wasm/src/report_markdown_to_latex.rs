//! Report Markdown to LaTeX for JavaScript (wf-core `report::markdown_to_latex`). The JS names
//! and shapes match `packages/core/src/features/report/domain/markdown-to-latex.ts`.
//!
//! The options cross as a plain JS object through serde. The TS wrapper in
//! `packages/wf-wasm/src/report-markdown-to-latex.ts` turns the `citeByTitle` map into an object.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::report::markdown_to_latex;
use wf_core::report::markdown_to_latex::MarkdownToLatexOptions;

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`escape_latex_text`](markdown_to_latex::escape_latex_text) (TS `escapeLatexText`).
#[wasm_bindgen(js_name = escapeLatexText)]
#[must_use]
pub fn escape_latex_text_js(s: &str) -> String {
    markdown_to_latex::escape_latex_text(s)
}

/// [`markdown_to_latex`](markdown_to_latex::markdown_to_latex) (TS `markdownToLatex`).
///
/// # Errors
///
/// Fails if `opts` is not an options object.
#[wasm_bindgen(js_name = markdownToLatex)]
pub fn markdown_to_latex_js(md: &str, opts: JsValue) -> JsResult<JsValue> {
    let opts: MarkdownToLatexOptions = serde_wasm_bindgen::from_value(opts)?;
    to_js(&markdown_to_latex::markdown_to_latex(md, &opts))
}
