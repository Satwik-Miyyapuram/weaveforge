//! Workspace shortcuts: the command a key chord means. Pure, so the awkward
//! cases are testable: a bare `F2` is rename but `Alt+F2` is not, `Ctrl-W`
//! is claimed before the host reads it as "close tab", and `Ctrl` and `Cmd`
//! are the same modifier.

use serde::{Deserialize, Serialize};

/// A key press, as the fields the workspace reads from a keyboard event.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct KeyChord {
    /// The character the key types, or a name such as `F2` or `Tab`.
    pub key: String,
    /// The physical key. Digits are read from here, since AZERTY types them as symbols.
    #[serde(default)]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub code: Option<String>,
    #[serde(default)]
    #[cfg_attr(feature = "specta", specta(optional))]
    /// Control is held.
    pub ctrl_key: bool,
    #[serde(default)]
    #[cfg_attr(feature = "specta", specta(optional))]
    /// Meta (Cmd) is held.
    pub meta_key: bool,
    #[serde(default)]
    #[cfg_attr(feature = "specta", specta(optional))]
    /// Shift is held.
    pub shift_key: bool,
    #[serde(default)]
    #[cfg_attr(feature = "specta", specta(optional))]
    /// Alt (Option) is held.
    pub alt_key: bool,
}

const TAB_COMMANDS: [&str; 8] = [
    "tab-1", "tab-2", "tab-3", "tab-4", "tab-5", "tab-6", "tab-7", "tab-8",
];

/// The command a chord means, or `None`.
///
/// `tab_count` is how many tabs the focused pane has, `None` for unbounded. A
/// tab-number chord with no tab behind it is not claimed, so the browser keeps
/// it (its own tab switch).
#[must_use]
pub fn command_for_chord(chord: &KeyChord, tab_count: Option<usize>) -> Option<&'static str> {
    let modifier = chord.ctrl_key || chord.meta_key;
    // F2 and F11 work bare, as in a file manager and a browser; a modified one
    // belongs to someone else.
    if !modifier && !chord.alt_key && !chord.shift_key {
        match chord.key.as_str() {
            "F2" => return Some("rename-doc"),
            // The document alone: no rail, explorer, strip or status bar.
            "F11" => return Some("toggle-focus"),
            _ => {}
        }
    }
    if !modifier || chord.alt_key {
        return None;
    }

    let key = chord.key.to_lowercase();
    match key.as_str() {
        "p" => {
            return Some(if chord.shift_key {
                "command-palette"
            } else {
                "quick-open"
            });
        }
        "d" if !chord.shift_key => return Some("duplicate-note"),
        "e" if !chord.shift_key => return Some("toggle-mode"),
        "n" if !chord.shift_key => return Some("new-note"),
        "b" => {
            return Some(if chord.shift_key {
                "toggle-sidebar"
            } else {
                "toggle-explorer"
            });
        }
        "f" if chord.shift_key => return Some("workspace-search"),
        _ => {}
    }
    // Read by physical key: on many layouts `/` needs Shift and types `?`.
    if key == "/" || chord.code.as_deref() == Some("Slash") {
        return Some("show-shortcuts");
    }
    match key.as_str() {
        "t" if chord.shift_key => return Some("reopen-tab"),
        "\\" => return Some("split-right"),
        "w" => return Some("close-tab"),
        "tab" => {
            return Some(if chord.shift_key {
                "previous-tab"
            } else {
                "next-tab"
            });
        }
        _ => {}
    }

    // `⌘0` stays the host's "reset zoom"; a shifted digit is a symbol.
    if chord.shift_key {
        return None;
    }
    let digit = digit_of(chord)?;
    if digit == 9 {
        return tab_count
            .is_none_or(|count| count >= 1)
            .then_some("last-tab");
    }
    if tab_count.is_some_and(|count| digit > count) {
        return None;
    }
    Some(TAB_COMMANDS[digit - 1])
}

/// The digit 1–9 a chord names by its physical key, else by its character.
fn digit_of(chord: &KeyChord) -> Option<usize> {
    let digit = |text: &str| match text.as_bytes() {
        [byte @ b'1'..=b'9'] => Some(usize::from(byte - b'0')),
        _ => None,
    };
    chord
        .code
        .as_deref()
        .and_then(|code| code.strip_prefix("Digit"))
        .and_then(digit)
        .or_else(|| digit(&chord.key))
}

#[cfg(test)]
mod tests {
    use super::{KeyChord, command_for_chord};

    fn chord(key: &str) -> KeyChord {
        KeyChord {
            key: key.to_owned(),
            ..KeyChord::default()
        }
    }

    fn ctrl(key: &str) -> KeyChord {
        KeyChord {
            ctrl_key: true,
            ..chord(key)
        }
    }

    #[test]
    fn ctrl_and_cmd_are_the_same_modifier() {
        assert_eq!(command_for_chord(&ctrl("p"), None), Some("quick-open"));
        let meta = KeyChord {
            meta_key: true,
            ..chord("P")
        };
        assert_eq!(command_for_chord(&meta, None), Some("quick-open"));
        assert_eq!(command_for_chord(&chord("p"), None), None);
    }

    #[test]
    fn shift_selects_the_sibling_command() {
        let shift = |key: &str| KeyChord {
            shift_key: true,
            ..ctrl(key)
        };
        assert_eq!(
            command_for_chord(&shift("P"), None),
            Some("command-palette")
        );
        assert_eq!(command_for_chord(&shift("B"), None), Some("toggle-sidebar"));
        assert_eq!(command_for_chord(&shift("T"), None), Some("reopen-tab"));
        assert_eq!(command_for_chord(&shift("D"), None), None);
    }

    #[test]
    fn bare_and_alt_function_keys() {
        assert_eq!(command_for_chord(&chord("F2"), None), Some("rename-doc"));
        assert_eq!(command_for_chord(&chord("F11"), None), Some("toggle-focus"));
        let alt_f2 = KeyChord {
            alt_key: true,
            ..chord("F2")
        };
        assert_eq!(command_for_chord(&alt_f2, None), None);
        assert_eq!(command_for_chord(&ctrl("F11"), None), None);
    }

    #[test]
    fn tab_digits_respect_the_tab_count() {
        assert_eq!(command_for_chord(&ctrl("3"), Some(3)), Some("tab-3"));
        assert_eq!(command_for_chord(&ctrl("5"), Some(3)), None);
        assert_eq!(command_for_chord(&ctrl("9"), Some(1)), Some("last-tab"));
        assert_eq!(command_for_chord(&ctrl("9"), Some(0)), None);
        assert_eq!(command_for_chord(&ctrl("1"), None), Some("tab-1"));
        assert_eq!(command_for_chord(&ctrl("0"), None), None);
    }

    #[test]
    fn physical_digit_code_wins_over_a_symbol_key() {
        let azerty = KeyChord {
            code: Some("Digit1".to_owned()),
            ..ctrl("&")
        };
        assert_eq!(command_for_chord(&azerty, Some(3)), Some("tab-1"));
    }

    #[test]
    fn slash_is_read_by_physical_key() {
        let shifted = KeyChord {
            code: Some("Slash".to_owned()),
            shift_key: true,
            ..ctrl("?")
        };
        assert_eq!(command_for_chord(&shifted, None), Some("show-shortcuts"));
        assert_eq!(command_for_chord(&ctrl("/"), None), Some("show-shortcuts"));
    }
}
