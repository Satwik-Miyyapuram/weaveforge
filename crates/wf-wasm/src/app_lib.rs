//! Small app-shell rules for JavaScript (wf-core `app_lib`): palette rows, saved preference
//! defaults, shortcut toggles, page body fallbacks and key-event checks.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::app_lib::toast_store::{self, Action, ToastState};
use wf_core::app_lib::{
    commit_enter, edit_menu, menu_palette, page_text, prefs, shortcuts, storage_keys,
};

use super::to_js;

/// [`textWithinCap`]: whether `text` is within the index cap (16Mi UTF-16 units). Callers use it to
/// pick the old TS fallback for longer text rather than sending it to the page-text rules.
#[must_use]
#[wasm_bindgen(js_name = textWithinCap)]
pub fn text_within_cap_js(text: &str) -> bool {
    // Same rule as `check_text`, without building a JS error (which panics off wasm).
    text.len() <= crate::MAX_INDEX_TEXT_UTF16
        || crate::utf16_len(text) <= crate::MAX_INDEX_TEXT_UTF16
}

/// [`is_hydrated_page`](page_text::is_hydrated_page): the page has a body and no preview stands in.
/// Never fails: the caller checks [`text_within_cap_js`] first and falls back to TS above the cap.
#[must_use]
#[wasm_bindgen(js_name = isHydratedPage)]
pub fn is_hydrated_page_js(body: Option<String>, body_preview: Option<String>) -> bool {
    page_text::is_hydrated_page(body.as_deref(), body_preview.as_deref())
}

/// [`body_text`](page_text::body_text): the full body when non-empty, else the preview, else `""`.
/// Never fails: the caller checks [`text_within_cap_js`] first and falls back to TS above the cap.
#[must_use]
#[wasm_bindgen(js_name = noteBodyText)]
pub fn note_body_text_js(body: Option<String>, body_preview: Option<String>) -> String {
    page_text::body_text(body.as_deref(), body_preview.as_deref()).to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::MAX_INDEX_TEXT_UTF16;

    #[test]
    fn text_at_the_cap_is_within_and_one_unit_over_is_not() {
        assert!(text_within_cap_js(&"a".repeat(MAX_INDEX_TEXT_UTF16)));
        assert!(!text_within_cap_js(&"a".repeat(MAX_INDEX_TEXT_UTF16 + 1)));
    }
}

/// [`menu_palette_actions`](menu_palette::menu_palette_actions): the palette rows the menu backs.
///
/// # Errors
///
/// Fails if `groups` has the wrong shape.
#[wasm_bindgen(js_name = menuPaletteActions, unchecked_return_type = "{ id: string; label: string }[]")]
pub fn menu_palette_actions_js(
    #[wasm_bindgen(
        unchecked_param_type = "readonly { items: { id: string; label: string; enabled: boolean }[] }[]"
    )]
    groups: JsValue,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let groups: Vec<menu_palette::MenuGroup> = serde_wasm_bindgen::from_value(groups)?;
    to_js(&menu_palette::menu_palette_actions(&groups))
}

/// [`settings_palette_rows`](menu_palette::settings_palette_rows): the Settings rows the bridge backs.
///
/// # Errors
///
/// Fails if the result cannot be converted to JS.
#[wasm_bindgen(js_name = settingsPaletteRows, unchecked_return_type = "{ key: string; label: string; path: string }[]")]
pub fn settings_palette_rows_js(
    has_plan_widget: bool,
    has_ink: bool,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    to_js(&menu_palette::settings_palette_rows(
        has_plan_widget,
        has_ink,
    ))
}

/// [`next_shortcuts_open`](shortcuts::next_shortcuts_open): whether the sheet is open after a request.
#[must_use]
#[wasm_bindgen(js_name = nextShortcutsOpen)]
pub fn next_shortcuts_open_js(open: bool, how: Option<String>) -> bool {
    shortcuts::next_shortcuts_open(open, how.as_deref())
}

/// [`ink_haptics_on`](prefs::ink_haptics_on): whether ink haptics are on for a saved value.
#[must_use]
#[wasm_bindgen(js_name = inkHapticsOn)]
pub fn ink_haptics_on_js(raw: Option<String>) -> bool {
    prefs::ink_haptics_on(raw.as_deref())
}

/// [`citation_format_storage_key`](prefs::citation_format_storage_key): the key for a project.
#[must_use]
#[wasm_bindgen(js_name = citationFormatStorageKey)]
pub fn citation_format_storage_key_js(project_id: Option<String>) -> String {
    prefs::citation_format_storage_key(project_id.as_deref())
}

/// [`parse_editor_citation_format`](prefs::parse_editor_citation_format): the saved format or `wikilink`.
#[must_use]
#[wasm_bindgen(js_name = parseEditorCitationFormat)]
pub fn parse_editor_citation_format_js(raw: Option<String>) -> String {
    prefs::parse_editor_citation_format(raw.as_deref()).to_owned()
}

/// [`parse_wikilink_create_mode`](prefs::parse_wikilink_create_mode): `never` or `create`.
#[must_use]
#[wasm_bindgen(js_name = parseWikilinkCreateMode)]
pub fn parse_wikilink_create_mode_js(raw: Option<String>) -> String {
    prefs::parse_wikilink_create_mode(raw.as_deref()).to_owned()
}

/// [`is_commit_enter`](commit_enter::is_commit_enter): Enter outside an IME composition.
#[must_use]
#[wasm_bindgen(js_name = isCommitEnter)]
pub fn is_commit_enter_js(key: &str, key_code: Option<u32>, is_composing: bool) -> bool {
    commit_enter::is_commit_enter(key, key_code, is_composing)
}

/// [`is_edit_command`](edit_menu::is_edit_command): paste or an execCommand edit command.
#[must_use]
#[wasm_bindgen(js_name = isEditCommand)]
pub fn is_edit_command_js(command: &str) -> bool {
    edit_menu::is_edit_command(command)
}

/// [`exec_command_name`](edit_menu::exec_command_name): the execCommand id for an edit command,
/// or `undefined` for paste and anything else.
#[must_use]
#[wasm_bindgen(js_name = execCommandName)]
pub fn exec_command_name_js(command: &str) -> Option<String> {
    edit_menu::exec_command_name(command).map(str::to_owned)
}

/// [`is_app_storage_key`](storage_keys::is_app_storage_key): whether a browser storage key holds
/// account or workspace state, so sign-out wipes it.
#[must_use]
#[wasm_bindgen(js_name = isAppStorageKey)]
pub fn is_app_storage_key_js(key: &str) -> bool {
    storage_keys::is_app_storage_key(key)
}

/// [`initial_state`](toast_store::initial_state): an empty toast store.
///
/// # Errors
///
/// Fails if the result cannot be converted to JS.
#[wasm_bindgen(js_name = toastInitialState, unchecked_return_type = "unknown")]
pub fn toast_initial_state_js() -> Result<JsValue, serde_wasm_bindgen::Error> {
    to_js(&toast_store::initial_state())
}

/// [`reduce`](toast_store::reduce): the next toast state, view, hidden keys and effects for one action.
///
/// # Errors
///
/// Fails if `state` or `action` is not a `ToastState` or `Action`-shaped object, or the result
/// cannot be converted to JS.
#[wasm_bindgen(js_name = toastReduce, unchecked_return_type = "unknown")]
pub fn toast_reduce_js(
    #[wasm_bindgen(unchecked_param_type = "unknown")] state: JsValue,
    #[wasm_bindgen(unchecked_param_type = "unknown")] action: JsValue,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let state: ToastState = serde_wasm_bindgen::from_value(state)?;
    let action: Action = serde_wasm_bindgen::from_value(action)?;
    to_js(&toast_store::reduce(state, action))
}
