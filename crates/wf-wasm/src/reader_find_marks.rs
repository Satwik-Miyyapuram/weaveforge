//! Find-match scrollbar ticks for JavaScript (`apps/web/src/features/reader/application/find-marks.ts`).
//! Wraps `wf_core::reader::find_marks`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::reader::find_marks::{FindMarkMatch, FindMarkPage, find_marks};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`find_marks`]: where each match falls in the document, as a fraction of its height.
///
/// # Errors
///
/// Fails if `matches` or `pages` do not have the expected shape.
#[wasm_bindgen(js_name = findMarks)]
pub fn find_marks_js(matches: JsValue, num_pages: f64, pages: JsValue) -> JsResult<JsValue> {
    let matches: Vec<FindMarkMatch> = serde_wasm_bindgen::from_value(matches)?;
    let pages: Vec<FindMarkPage> = serde_wasm_bindgen::from_value(pages)?;
    to_js(&find_marks(&matches, num_pages, &pages))
}
