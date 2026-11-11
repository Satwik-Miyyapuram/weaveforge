//! Report Markdown to LaTeX for JavaScript (wf-core `report::markdown_to_latex`). The JS names
//! and shapes match `packages/core/src/features/report/domain/parts.ts`.
//!
//! The options cross as a plain JS object through serde. The TS wrapper in
//! `packages/wf-wasm/src/wrappers-8.ts` turns the `citeByTitle` map into an object.

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

/// [`unique_figure_name`](markdown_to_latex::unique_figure_name) over a list of the names
/// already used (TS `uniqueFigureName`; the TS wrapper adds the result to its `Set`).
///
/// # Errors
///
/// Fails if `used` is not an array of strings.
#[wasm_bindgen(js_name = uniqueFigureNameIn)]
pub fn unique_figure_name_js(
    raw: &str,
    #[wasm_bindgen(unchecked_param_type = "readonly string[]")] used: JsValue,
) -> JsResult<String> {
    let used: Vec<String> = serde_wasm_bindgen::from_value(used)?;
    let mut used: std::collections::HashSet<String> = used.into_iter().collect();
    Ok(markdown_to_latex::unique_figure_name(raw, &mut used))
}
