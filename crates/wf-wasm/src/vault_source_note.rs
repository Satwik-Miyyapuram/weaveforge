//! Source-note template context for JavaScript (wf-core `vault::source_note_context`). The TS
//! wrapper in `packages/wf-wasm/src/vault-source-note.ts` applies the types.

use serde::de::DeserializeOwned;
use wasm_bindgen::prelude::wasm_bindgen;
use wasm_bindgen::{JsError, JsValue};
use wf_core::vault::source_note_context::{SourceNoteInput, source_note_template_context};

use super::to_js;

fn parse<T: DeserializeOwned>(value: JsValue) -> Result<T, JsError> {
    serde_wasm_bindgen::from_value(value).map_err(|error| JsError::new(&error.to_string()))
}

/// [`source_note_template_context`]: the `{{...}}` values for a paper's source note.
#[wasm_bindgen(js_name = sourceNoteTemplateContext)]
pub fn source_note_template_context_js(input: JsValue) -> Result<JsValue, JsError> {
    let input: SourceNoteInput = parse(input)?;
    to_js(&source_note_template_context(&input)).map_err(|error| JsError::new(&error.to_string()))
}
