//! Reader annotation type guards and keyboard command mapping. A faithful port of
//! `packages/core/src/reader/parts.ts` and `packages/core/src/reader/reader-keyboard.ts`.
//!
//! Stays in TS: `resolvePdfSource` in `pdf-source-ladder.ts` (async, calls injected resolvers).

use serde::{Deserialize, Serialize};

/// Zotero's six annotation types, in TS order (`READER_ANNOTATION_TYPES`). No `strikeout`.
const READER_ANNOTATION_TYPES: [&str; 6] =
    ["highlight", "underline", "note", "image", "ink", "text"];

/// R5 write-back states, in TS order (`ANNOTATION_SYNC_STATES`).
const ANNOTATION_SYNC_STATES: [&str; 4] = ["local", "synced", "pending", "conflict"];

/// Whether `value` is one of the reader annotation types (TS `isReaderAnnotationType`).
#[must_use]
pub fn is_reader_annotation_type(value: &str) -> bool {
    READER_ANNOTATION_TYPES.contains(&value)
}

/// Whether `value` is one of the sync states (TS `isAnnotationSyncState`).
#[must_use]
pub fn is_annotation_sync_state(value: &str) -> bool {
    ANNOTATION_SYNC_STATES.contains(&value)
}

/// The keyboard event fields `readerKeyboardCommand` reads (TS `ReaderKeyEvent`).
/// Missing fields take the TS `undefined` meaning: no key, no code, no modifier.
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(default, rename_all = "camelCase")]
pub struct ReaderKeyEvent {
    /// `KeyboardEvent.key`.
    pub key: Option<String>,
    /// `KeyboardEvent.code`.
    pub code: Option<String>,
    /// Ctrl held.
    pub ctrl_key: bool,
    /// Meta (Cmd) held.
    pub meta_key: bool,
    /// Alt held.
    pub alt_key: bool,
    /// The event came from an editable field, so the reader ignores it.
    pub from_editable: bool,
}

/// A viewport command (TS `ReaderKeyboardCommand`), tagged by `type` as in TS.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ReaderKeyboardCommand {
    /// Move by `delta` pages.
    PageDelta {
        /// Pages to move; negative goes back.
        delta: i32,
    },
    /// Go to the first page.
    PageHome,
    /// Go to the last page.
    PageEnd,
    /// Zoom in one step.
    ZoomIn,
    /// Zoom out one step.
    ZoomOut,
    /// Fit the page width.
    FitWidth,
    /// Rotate the page.
    Rotate,
}

/// Whether `value` equals `expected`, false when `value` is absent (JS `undefined`).
fn is(value: Option<&str>, expected: &str) -> bool {
    value == Some(expected)
}

/// The command for a navigable key, or `None` when the event passes through
/// (TS `readerKeyboardCommand`). Editable-field and Alt events are ignored so
/// page-jump inputs keep working.
#[must_use]
pub fn reader_keyboard_command(event: &ReaderKeyEvent) -> Option<ReaderKeyboardCommand> {
    if event.from_editable || event.alt_key {
        return None;
    }

    let key = event.key.as_deref();
    let code = event.code.as_deref();
    let modifier = event.ctrl_key || event.meta_key;

    if is(key, "+")
        || is(key, "=")
        || is(key, "Add")
        || is(code, "NumpadAdd")
        || (modifier && (is(code, "Equal") || is(key, "=") || is(key, "+")))
    {
        return Some(ReaderKeyboardCommand::ZoomIn);
    }
    if is(key, "-")
        || is(key, "_")
        || is(key, "Subtract")
        || is(code, "NumpadSubtract")
        || (modifier && (is(code, "Minus") || is(key, "-") || is(key, "_")))
    {
        return Some(ReaderKeyboardCommand::ZoomOut);
    }
    if (is(key, "r") || is(key, "R")) && !modifier {
        return Some(ReaderKeyboardCommand::Rotate);
    }
    if (is(key, "0") || is(code, "Digit0") || is(code, "Numpad0")) && modifier {
        return Some(ReaderKeyboardCommand::FitWidth);
    }

    match key {
        Some("ArrowDown" | "PageDown" | "j" | "ArrowRight") => {
            Some(ReaderKeyboardCommand::PageDelta { delta: 1 })
        }
        Some("ArrowUp" | "PageUp" | "k" | "ArrowLeft") => {
            Some(ReaderKeyboardCommand::PageDelta { delta: -1 })
        }
        Some("Home") => Some(ReaderKeyboardCommand::PageHome),
        Some("End") => Some(ReaderKeyboardCommand::PageEnd),
        _ => None,
    }
}

/// Tag names whose own keyboard handling wins over reader shortcuts. `SELECT`
/// matters as much as the text inputs: arrows change the option and letters
/// type ahead, so swallowing them breaks the dropdowns.
const EDITABLE_TAGS: [&str; 4] = ["INPUT", "TEXTAREA", "SELECT", "OPTION"];

/// Whether an event target owns its keystrokes (TS `isEditableReaderTarget`):
/// anything contenteditable, or a text field, select or option by tag name in
/// any case. The caller reads `tagName` and `isContentEditable` off the DOM.
#[must_use]
pub fn is_editable_reader_target(tag_name: Option<&str>, content_editable: bool) -> bool {
    content_editable
        || tag_name.is_some_and(|tag| EDITABLE_TAGS.contains(&tag.to_uppercase().as_str()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn editable_targets_own_their_keys() {
        for tag in ["SELECT", "OPTION", "INPUT", "TEXTAREA", "input"] {
            assert!(is_editable_reader_target(Some(tag), false), "{tag}");
        }
        assert!(is_editable_reader_target(Some("DIV"), true));
        assert!(is_editable_reader_target(None, true));
        assert!(!is_editable_reader_target(Some("BUTTON"), false));
        assert!(!is_editable_reader_target(Some("DIV"), false));
        assert!(!is_editable_reader_target(Some(""), false));
        assert!(!is_editable_reader_target(None, false));
    }

    fn key(k: &str) -> ReaderKeyEvent {
        ReaderKeyEvent {
            key: Some(k.to_owned()),
            ..Default::default()
        }
    }

    fn keyed(k: &str, code: Option<&str>) -> ReaderKeyEvent {
        ReaderKeyEvent {
            code: code.map(str::to_owned),
            ..key(k)
        }
    }

    fn with_ctrl(k: &str, code: Option<&str>) -> ReaderKeyEvent {
        ReaderKeyEvent {
            ctrl_key: true,
            ..keyed(k, code)
        }
    }

    fn with_meta(k: &str, code: Option<&str>) -> ReaderKeyEvent {
        ReaderKeyEvent {
            meta_key: true,
            ..keyed(k, code)
        }
    }

    fn cmd(event: &ReaderKeyEvent) -> Option<ReaderKeyboardCommand> {
        reader_keyboard_command(event)
    }

    // readerKeyboardCommand maps zoom and rotate keys

    #[test]
    fn maps_zoom_and_rotate_keys() {
        assert_eq!(cmd(&key("+")), Some(ReaderKeyboardCommand::ZoomIn));
        assert_eq!(cmd(&key("=")), Some(ReaderKeyboardCommand::ZoomIn));
        assert_eq!(cmd(&key("-")), Some(ReaderKeyboardCommand::ZoomOut));
        assert_eq!(cmd(&key("r")), Some(ReaderKeyboardCommand::Rotate));
        assert_eq!(
            cmd(&with_ctrl("0", None)),
            Some(ReaderKeyboardCommand::FitWidth)
        );
        assert_eq!(
            cmd(&with_ctrl("+", None)),
            Some(ReaderKeyboardCommand::ZoomIn)
        );
        assert_eq!(
            cmd(&with_ctrl("=", None)),
            Some(ReaderKeyboardCommand::ZoomIn)
        );
        assert_eq!(
            cmd(&with_ctrl("-", None)),
            Some(ReaderKeyboardCommand::ZoomOut)
        );
        assert_eq!(cmd(&key("Add")), Some(ReaderKeyboardCommand::ZoomIn));
        assert_eq!(cmd(&key("Subtract")), Some(ReaderKeyboardCommand::ZoomOut));
        assert_eq!(
            cmd(&with_ctrl("=", Some("Equal"))),
            Some(ReaderKeyboardCommand::ZoomIn)
        );
        assert_eq!(
            cmd(&with_ctrl("-", Some("Minus"))),
            Some(ReaderKeyboardCommand::ZoomOut)
        );
        assert_eq!(
            cmd(&with_ctrl("0", Some("Digit0"))),
            Some(ReaderKeyboardCommand::FitWidth)
        );
        assert_eq!(
            cmd(&with_meta("0", Some("Numpad0"))),
            Some(ReaderKeyboardCommand::FitWidth)
        );
    }

    // readerKeyboardCommand maps page navigation

    #[test]
    fn maps_page_navigation() {
        assert_eq!(
            cmd(&key("ArrowDown")),
            Some(ReaderKeyboardCommand::PageDelta { delta: 1 })
        );
        assert_eq!(
            cmd(&key("PageUp")),
            Some(ReaderKeyboardCommand::PageDelta { delta: -1 })
        );
        assert_eq!(cmd(&key("Home")), Some(ReaderKeyboardCommand::PageHome));
        assert_eq!(cmd(&key("End")), Some(ReaderKeyboardCommand::PageEnd));
        assert_eq!(
            cmd(&key("j")),
            Some(ReaderKeyboardCommand::PageDelta { delta: 1 })
        );
        assert_eq!(
            cmd(&key("k")),
            Some(ReaderKeyboardCommand::PageDelta { delta: -1 })
        );
    }

    // readerKeyboardCommand ignores editable targets and unknown keys

    #[test]
    fn ignores_editable_targets_and_unknown_keys() {
        let editable = ReaderKeyEvent {
            from_editable: true,
            ..key("ArrowDown")
        };
        assert_eq!(cmd(&editable), None);
        assert_eq!(cmd(&key("a")), None);
        let alt = ReaderKeyEvent {
            alt_key: true,
            ..key("ArrowDown")
        };
        assert_eq!(cmd(&alt), None);
    }

    // readerKeyboardCommand yields to editable targets for every shortcut

    #[test]
    fn yields_to_editable_targets_for_every_shortcut() {
        for k in [
            "ArrowDown",
            "ArrowUp",
            "PageDown",
            "Home",
            "End",
            "+",
            "-",
            "r",
            "j",
            "k",
        ] {
            let event = ReaderKeyEvent {
                from_editable: true,
                ..key(k)
            };
            assert_eq!(cmd(&event), None, "{k} should pass through to the field");
        }
    }

    // Ctrl/Cmd+R is left to the browser as reload, not rotate (07-01)

    #[test]
    fn ctrl_or_meta_r_is_not_rotate() {
        assert_eq!(cmd(&with_ctrl("r", None)), None);
        assert_eq!(cmd(&with_meta("r", None)), None);
        assert_eq!(cmd(&with_ctrl("R", None)), None);
        assert_eq!(cmd(&key("R")), Some(ReaderKeyboardCommand::Rotate));
    }

    // readerKeyboardCommand edge cases: no key at all, and ArrowRight/ArrowLeft

    #[test]
    fn missing_key_is_a_pass_through() {
        assert_eq!(cmd(&ReaderKeyEvent::default()), None);
        assert_eq!(
            cmd(&ReaderKeyEvent {
                code: Some("NumpadAdd".to_owned()),
                ..Default::default()
            }),
            Some(ReaderKeyboardCommand::ZoomIn)
        );
    }

    #[test]
    fn arrow_left_and_right_page() {
        assert_eq!(
            cmd(&key("ArrowRight")),
            Some(ReaderKeyboardCommand::PageDelta { delta: 1 })
        );
        assert_eq!(
            cmd(&key("ArrowLeft")),
            Some(ReaderKeyboardCommand::PageDelta { delta: -1 })
        );
    }

    // READER_ANNOTATION_TYPES is Zotero's six, no strikeout

    #[test]
    fn annotation_types_are_zotero_six() {
        assert_eq!(
            READER_ANNOTATION_TYPES,
            ["highlight", "underline", "note", "image", "ink", "text"]
        );
        assert!(is_reader_annotation_type("highlight"));
        assert!(is_reader_annotation_type("text"));
        assert!(!is_reader_annotation_type("strikeout"));
        assert!(!is_reader_annotation_type(""));
    }

    #[test]
    fn sync_states_are_the_four_r5_states() {
        assert!(is_annotation_sync_state("local"));
        assert!(is_annotation_sync_state("conflict"));
        assert!(!is_annotation_sync_state("Synced"));
        assert!(!is_annotation_sync_state(""));
    }
}
