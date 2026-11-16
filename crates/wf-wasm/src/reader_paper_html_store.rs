//! Paper HTML store folder for JavaScript (`apps/web/src/features/reader/infrastructure/paper-html-store.ts`).
//! Wraps `wf_core::reader::paper_html_store`. The IndexedDB rows and the file I/O stay in TS.

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::reader::paper_html_store::paper_html_dir;

/// [`paper_html_dir`]: the folder kept paper pages are written to. Absent `projectRoot` reads as `""`.
#[wasm_bindgen(js_name = paperHtmlDir)]
pub fn paper_html_dir_js(project_root: Option<String>) -> String {
    paper_html_dir(project_root.as_deref().unwrap_or(""))
}
