//! Overleaf project tree flattening for JavaScript (wf-core `overleaf_tree`). The TS wrapper in
//! `packages/wf-wasm/src/overleaf-tree.ts` applies the types.

use serde::de::DeserializeOwned;
use serde_json::Value;
use wasm_bindgen::prelude::wasm_bindgen;
use wasm_bindgen::{JsError, JsValue};
use wf_core::overleaf_tree::{TreeKind, flatten};

use super::to_js;

fn parse<T: DeserializeOwned>(value: JsValue) -> Result<T, JsError> {
    serde_wasm_bindgen::from_value(value).map_err(|error| JsError::new(&error.to_string()))
}

#[allow(clippy::needless_pass_by_value)] // `map_err` hands the error over by value.
fn js_error(error: serde_wasm_bindgen::Error) -> JsError {
    JsError::new(&error.to_string())
}

/// [`flatten`] over `docs`: the project's text files as paths, in walk order.
#[wasm_bindgen(js_name = flattenOverleafDocs, unchecked_return_type = "B.LiveDocEntry[]")]
pub fn flatten_overleaf_docs(
    #[wasm_bindgen(unchecked_param_type = "unknown")] root_folder: JsValue,
) -> Result<JsValue, JsError> {
    let root: Value = parse(root_folder)?;
    to_js(&flatten(&root, TreeKind::Docs)).map_err(js_error)
}

/// [`flatten`] over `fileRefs`: the project's binary files as paths, in walk order.
#[wasm_bindgen(js_name = flattenOverleafFiles, unchecked_return_type = "B.LiveDocEntry[]")]
pub fn flatten_overleaf_files(
    #[wasm_bindgen(unchecked_param_type = "unknown")] root_folder: JsValue,
) -> Result<JsValue, JsError> {
    let root: Value = parse(root_folder)?;
    to_js(&flatten(&root, TreeKind::FileRefs)).map_err(js_error)
}
