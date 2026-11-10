//! Outside-edit triage for JavaScript (wf-core `workspace::outside_edits`).
//! The JS names match `packages/wf-wasm/src/workspace-outside-edits.ts`.

use std::collections::BTreeMap;

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::workspace::outside_edits::{self, SeenFile, SplitInput};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`split_outside_edits`](outside_edits::split_outside_edits) on `{ notes, rows, seen }`,
/// returning `{ noteHeld, rowHeld, reasons }`.
///
/// # Errors
///
/// Fails if the input does not match the shape, or the result cannot be serialized.
#[wasm_bindgen(js_name = splitOutsideEdits)]
pub fn split_outside_edits_js(input: JsValue) -> JsResult<JsValue> {
    let input: SplitInput = serde_wasm_bindgen::from_value(input)?;
    to_js(&outside_edits::split_outside_edits(&input))
}

/// [`renamed_paths`](outside_edits::renamed_paths) over `seen` and the diff's `paths`.
///
/// # Errors
///
/// Fails if the inputs do not match the shape, or the result cannot be serialized.
#[wasm_bindgen(js_name = renamedOutsidePaths)]
pub fn renamed_outside_paths_js(seen: JsValue, paths: JsValue) -> JsResult<JsValue> {
    let seen: BTreeMap<String, SeenFile> = serde_wasm_bindgen::from_value(seen)?;
    let paths: Vec<String> = serde_wasm_bindgen::from_value(paths)?;
    to_js(&outside_edits::renamed_paths(&seen, &paths))
}
