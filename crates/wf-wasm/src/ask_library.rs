//! Ask-your-library prompt for JavaScript (wf-core `search::ask_library`).
//! The JS names match `apps/web/src/features/search/application/ask-library.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::search::ask_library::{self, AskSource};

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`ask_prompt`](ask_library::ask_prompt): `{ system, user }` for the sources as passed.
#[wasm_bindgen(js_name = askPrompt)]
pub fn ask_prompt_js(question: &str, sources: JsValue, nonce: &str) -> JsResult<JsValue> {
    let sources: Vec<AskSource> = serde_wasm_bindgen::from_value(sources)?;
    serde_wasm_bindgen::to_value(&ask_library::ask_prompt(question, &sources, nonce))
}
