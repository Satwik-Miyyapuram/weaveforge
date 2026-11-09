//! Mermaid label quoting for JavaScript (wf-core `markdown_mermaid_labels`).

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::markdown_mermaid_labels;

/// [`quote_awkward_labels`](markdown_mermaid_labels::quote_awkward_labels): quote labels Mermaid cannot parse.
#[wasm_bindgen(js_name = quoteAwkwardMermaidLabels)]
#[must_use]
pub fn quote_awkward_mermaid_labels_js(code: &str) -> String {
    markdown_mermaid_labels::quote_awkward_labels(code)
}
