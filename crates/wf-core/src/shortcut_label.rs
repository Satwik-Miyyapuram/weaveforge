//! Shortcut text for the platform it is read on, ported from
//! `apps/web/src/lib/shortcut-label.ts`. Chords are written once with Mac glyphs
//! (`⌘⇧F`); off a Mac they read `Ctrl+Shift+F`. The platform check stays in the
//! web app, which passes `mac` in. Pure.

/// Glyph to word, for keys off a Mac.
const WORDS: &[(&str, &str)] = &[
    ("\u{2318}", "Ctrl"),
    ("\u{2303}", "Ctrl"),
    ("\u{21e7}", "Shift"),
    ("\u{2325}", "Alt"),
    ("\u{21e5}", "Tab"),
];

/// The modifier glyphs that may lead a chord.
const MODIFIERS: &[char] = &['\u{2318}', '\u{2303}', '\u{21e7}', '\u{2325}'];

fn word_for(key: &str) -> Option<&'static str> {
    WORDS
        .iter()
        .find(|(glyph, _)| *glyph == key)
        .map(|(_, word)| *word)
}

/// One keycap: `⌘` reads `Ctrl` off a Mac. Mac keys are returned unchanged.
#[must_use]
pub fn key_label(key: &str, mac: bool) -> String {
    if mac {
        return key.to_string();
    }
    word_for(key).unwrap_or(key).to_string()
}

/// A whole chord: `⌘⇧F` reads `Ctrl+Shift+F` off a Mac. Each leading modifier is
/// one cap; the key after them is one cap, so `F11` stays whole.
#[must_use]
pub fn shortcut_label(chord: &str, mac: bool) -> String {
    if mac {
        return chord.to_string();
    }
    let mods_len: usize = chord
        .chars()
        .take_while(|c| MODIFIERS.contains(c))
        .map(char::len_utf8)
        .sum();
    let (mods, rest) = chord.split_at(mods_len);

    let mut caps: Vec<&str> = mods
        .char_indices()
        .map(|(i, c)| &mods[i..i + c.len_utf8()])
        .collect();
    if !rest.is_empty() {
        caps.push(rest);
    }
    caps.into_iter()
        .map(|key| word_for(key).unwrap_or(key))
        .collect::<Vec<_>>()
        .join("+")
}

#[cfg(test)]
mod tests {
    use super::{key_label, shortcut_label};

    #[test]
    fn windows_reads_ctrl_shift_alt_joined_with_plus() {
        assert_eq!(shortcut_label("\u{2318}\u{21e7}F", false), "Ctrl+Shift+F");
        assert_eq!(shortcut_label("\u{2318}Z", false), "Ctrl+Z");
        assert_eq!(
            shortcut_label("\u{2318}\u{21e7}\u{21e5}", false),
            "Ctrl+Shift+Tab"
        );
        assert_eq!(shortcut_label("\u{2325}\u{2318}\\", false), "Alt+Ctrl+\\");
        assert_eq!(shortcut_label("\u{2303}C", false), "Ctrl+C");
    }

    #[test]
    fn function_key_stays_whole() {
        assert_eq!(shortcut_label("\u{21e7}F11", false), "Shift+F11");
    }

    #[test]
    fn mac_keeps_the_glyphs() {
        assert_eq!(
            shortcut_label("\u{2318}\u{21e7}F", true),
            "\u{2318}\u{21e7}F"
        );
        assert_eq!(key_label("\u{2318}", true), "\u{2318}");
    }

    #[test]
    fn single_key_cap() {
        assert_eq!(key_label("\u{21e7}", false), "Shift");
        assert_eq!(key_label("K", false), "K");
        assert_eq!(shortcut_label("", false), "");
    }
}
