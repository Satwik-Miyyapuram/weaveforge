//! Reference popover rules for JavaScript (`apps/web/src/features/reader/application/parts-2.ts`).
//! Wraps `wf_core::reader::reference_actions`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::reader::reference_actions::{manual_input_from_reference, reference_ref};
use wf_core::reader_analysis::types::AnalysisParsedReference;

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`reference_ref`]: the paper reference a bibliography entry resolves by.
#[wasm_bindgen(js_name = referenceRef, unchecked_return_type = "{ kind: \"doi\"; value: string } | { kind: \"arxiv\"; value: string } | { kind: \"bibliographic\"; value: string; hints: { title?: string; year?: number; firstAuthor?: string } }")]
pub fn reference_ref_js(
    #[wasm_bindgen(unchecked_param_type = "unknown")] entry: JsValue,
) -> JsResult<JsValue> {
    let entry: AnalysisParsedReference = serde_wasm_bindgen::from_value(entry)?;
    to_js(&reference_ref(&entry))
}

/// [`manual_input_from_reference`]: the fields a manual add can fill from an entry.
#[wasm_bindgen(js_name = manualInputFromReference, unchecked_return_type = "{ title: string; status: \"to_read\"; authors?: string[]; year?: number; doi?: string; arxivId?: string; url?: string }")]
pub fn manual_input_from_reference_js(
    #[wasm_bindgen(unchecked_param_type = "unknown")] entry: JsValue,
) -> JsResult<JsValue> {
    let entry: AnalysisParsedReference = serde_wasm_bindgen::from_value(entry)?;
    to_js(&manual_input_from_reference(&entry))
}
