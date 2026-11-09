//! Heading anchor id for JavaScript (wf-core `heading_slug`).

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::heading_slug;

/// [`heading_slug`](heading_slug::heading_slug): the anchor id for a heading.
#[wasm_bindgen(js_name = headingSlug)]
#[must_use]
pub fn heading_slug_js(text: &str) -> String {
    heading_slug::heading_slug(text)
}
