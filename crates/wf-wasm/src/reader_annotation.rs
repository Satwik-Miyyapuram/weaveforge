//! Reader annotation type guards and keyboard command mapping for JavaScript.
//! Each export wraps a `wf_core::reader::annotation` function; the JS shapes
//! match `packages/core/src/reader/parts.ts` and `reader-keyboard.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::reader::annotation::{
    ReaderKeyEvent, is_annotation_sync_state, is_editable_reader_target, is_reader_annotation_type,
    reader_keyboard_command,
};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`is_reader_annotation_type`] for any JS value: false unless `value` is a string.
#[must_use]
#[wasm_bindgen(js_name = isReaderAnnotationType)]
pub fn is_reader_annotation_type_js(
    #[wasm_bindgen(unchecked_param_type = "string")] value: &JsValue,
) -> bool {
    value
        .as_string()
        .is_some_and(|s| is_reader_annotation_type(&s))
}

/// [`is_annotation_sync_state`] for any JS value: false unless `value` is a string.
#[must_use]
#[wasm_bindgen(js_name = isAnnotationSyncState)]
pub fn is_annotation_sync_state_js(
    #[wasm_bindgen(unchecked_param_type = "string")] value: &JsValue,
) -> bool {
    value
        .as_string()
        .is_some_and(|s| is_annotation_sync_state(&s))
}

/// [`is_editable_reader_target`]: whether a target with this `tagName` and
/// `isContentEditable` owns its keystrokes.
#[must_use]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs an owned Option<String>.
#[wasm_bindgen(js_name = isEditableReaderTarget)]
pub fn is_editable_reader_target_js(tag_name: Option<String>, content_editable: bool) -> bool {
    is_editable_reader_target(tag_name.as_deref(), content_editable)
}

/// [`reader_keyboard_command`]: the `ReaderKeyboardCommand` for `event`, or `null`
/// when the event passes through.
///
/// # Errors
///
/// Fails if `event` is not a `ReaderKeyEvent` object.
#[wasm_bindgen(js_name = readerKeyboardCommand)]
pub fn reader_keyboard_command_js(event: JsValue) -> JsResult<JsValue> {
    let event: ReaderKeyEvent = serde_wasm_bindgen::from_value(event)?;
    to_js(&reader_keyboard_command(&event))
}
