//! Report Markdown to LaTeX for JavaScript (wf-core `report::markdown_to_latex`). The JS names
//! and shapes match `packages/core/src/features/report/domain/parts.ts`.
//!
//! The options cross as a plain JS object through serde; `citeByTitle` may be a JS `Map`.

use js_sys::Set;
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

/// [`markdown_to_latex`](markdown_to_latex::markdown_to_latex) (TS `markdownToLatex`): the
/// report Markdown as a LaTeX body, with warnings, figures and cited keys. `citeByTitle` maps
/// normalized paper titles to bib keys. A missing `md` reads as `""`, missing `opts` as `{}`.
///
/// # Errors
///
/// Fails if `opts` is not an options object.
#[wasm_bindgen(js_name = markdownToLatex, unchecked_return_type = "B.MarkdownToLatexResult")]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn markdown_to_latex_js(
    md: Option<String>,
    #[wasm_bindgen(
        unchecked_optional_param_type = "{ citeByTitle?: ReadonlyMap<string, string> }"
    )]
    opts: Option<JsValue>,
) -> JsResult<JsValue> {
    let opts: MarkdownToLatexOptions = match opts {
        Some(opts) if !opts.is_undefined() => serde_wasm_bindgen::from_value(opts)?,
        _ => MarkdownToLatexOptions::default(),
    };
    to_js(&markdown_to_latex::markdown_to_latex(
        md.as_deref().unwrap_or(""),
        &opts,
    ))
}

/// [`unique_figure_name`](markdown_to_latex::unique_figure_name) (TS `uniqueFigureName`): a
/// file-safe figure name not in `used`; the name is added to `used`.
///
/// # Errors
///
/// Fails if `used` holds a non-string.
#[wasm_bindgen(js_name = uniqueFigureName)]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn unique_figure_name_js(
    raw: &str,
    #[wasm_bindgen(unchecked_param_type = "Set<string>")] used: Set,
) -> JsResult<String> {
    let taken: Vec<String> = serde_wasm_bindgen::from_value(JsValue::from(used.clone()))?;
    let mut taken: std::collections::HashSet<String> = taken.into_iter().collect();
    let name = markdown_to_latex::unique_figure_name(raw, &mut taken);
    let _ = used.add(&JsValue::from_str(&name));
    Ok(name)
}
