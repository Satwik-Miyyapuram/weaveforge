//! Mermaid source and cache id for JavaScript (wf-core `markdown_input::mermaid_source`).

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::markdown_input::mermaid_source;

/// [`render_source`](mermaid_source::render_source) (TS `renderMermaidBlock`'s trim and label
/// quoting): the source the renderer draws.
#[wasm_bindgen(js_name = mermaidRenderSource)]
#[must_use]
pub fn mermaid_render_source_js(code: &str) -> String {
    mermaid_source::render_source(code)
}

/// [`diagram_id`](mermaid_source::diagram_id) (TS `diagramId`): the SVG id for a diagram source.
#[wasm_bindgen(js_name = mermaidDiagramId)]
#[must_use]
pub fn mermaid_diagram_id_js(source: &str) -> String {
    mermaid_source::diagram_id(source)
}
