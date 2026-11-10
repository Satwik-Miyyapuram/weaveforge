//! wasm exports for `screen_for_path` (TS: `screen-for-path.ts`).

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::screen_for_path;

/// [`screen_for_path::screen_for_path`]: the screen cache id for a pathname, or `undefined`.
#[wasm_bindgen(js_name = screenForPath)]
#[must_use]
pub fn screen_for_path_js(pathname: &str) -> Option<String> {
    screen_for_path::screen_for_path(pathname).map(str::to_string)
}
