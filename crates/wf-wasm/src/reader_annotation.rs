//! Reader annotation type guards and keyboard command mapping for JavaScript.
//! Each export wraps a `wf_core::reader::annotation` function; the JS shapes
//! match `packages/core/src/reader/parts.ts` and `reader-keyboard.ts`.

use js_sys::Reflect;
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::reader::annotation::{
    ReaderKeyEvent, is_annotation_sync_state, is_editable_reader_target, is_reader_annotation_type,
    reader_keyboard_command,
};

use super::to_js;

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

/// [`is_editable_reader_target`]: whether an event target owns its keystrokes (a text
/// field, a select or its option, or anything contenteditable). A falsy target never does;
/// `tagName` counts only when it is a string.
#[must_use]
#[wasm_bindgen(js_name = isEditableReaderTarget)]
pub fn is_editable_reader_target_js(
    #[wasm_bindgen(
        unchecked_param_type = "EventTarget | { tagName?: unknown; isContentEditable?: unknown } | null | undefined"
    )]
    target: &JsValue,
) -> bool {
    if !target.is_truthy() {
        return false;
    }
    let tag_name = Reflect::get(target, &JsValue::from_str("tagName"))
        .ok()
        .and_then(|tag| tag.as_string());
    let content_editable = Reflect::get(target, &JsValue::from_str("isContentEditable"))
        .is_ok_and(|flag| flag.is_truthy());
    is_editable_reader_target(tag_name.as_deref(), content_editable)
}

/// `event[name]` as a string, or `None` when missing or not a string.
fn string_field(event: &JsValue, name: &str) -> Result<Option<String>, JsValue> {
    Ok(Reflect::get(event, &JsValue::from_str(name))?.as_string())
}

/// `Boolean(event[name])`.
fn flag_field(event: &JsValue, name: &str) -> Result<bool, JsValue> {
    Ok(Reflect::get(event, &JsValue::from_str(name))?.is_truthy())
}

/// [`reader_keyboard_command`]: the `ReaderKeyboardCommand` for `event`, or `null`
/// when the event passes through. Editable and Alt events always pass through. The modifier
/// fields read as `Boolean(field)`.
///
/// # Errors
///
/// Fails if `event` is not an object, or the result cannot be converted.
#[wasm_bindgen(
    js_name = readerKeyboardCommand,
    unchecked_return_type = "B.ReaderKeyboardCommand | null"
)]
pub fn reader_keyboard_command_js(
    #[wasm_bindgen(
        unchecked_param_type = "{ key: string; code?: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; fromEditable?: boolean }"
    )]
    event: &JsValue,
) -> Result<JsValue, JsValue> {
    let event = ReaderKeyEvent {
        key: string_field(event, "key")?,
        code: string_field(event, "code")?,
        ctrl_key: flag_field(event, "ctrlKey")?,
        meta_key: flag_field(event, "metaKey")?,
        alt_key: flag_field(event, "altKey")?,
        from_editable: flag_field(event, "fromEditable")?,
    };
    to_js(&reader_keyboard_command(&event)).map_err(JsValue::from)
}
