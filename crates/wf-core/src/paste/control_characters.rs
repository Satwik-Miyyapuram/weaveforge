//! Escape sequences and control characters that survive a copy out of a
//! terminal.
//!
//! Port of `packages/core/src/paste/control-characters.ts`. The TS patterns
//! were regexes over escape strings; these are byte scanners with the same
//! match rules. The passes run in the TS order, each over the previous output.

use std::ops::RangeInclusive;

/// The escape character, `\u{1B}`.
const ESC: u8 = 0x1B;
/// The bell character, `\u{7}`, which can close an OSC sequence.
const BEL: u8 = 0x07;

/// A pass: the first `(start, end)` match at or after `from`.
type Matcher = fn(&[u8], usize) -> Option<(usize, usize)>;

/// Removes ANSI escape sequences and stray control characters.
#[must_use]
pub fn strip_control_sequences(text: &str) -> String {
    let text = remove_all(text, string_sequence);
    let text = remove_all(&text, osc_sequence);
    let text = remove_all(&text, csi_sequence);
    let text = remove_all(&text, simple_sequence);
    text.chars().filter(|&ch| !is_stray_control(ch)).collect()
}

/// Removes every match of `find`, scanning left to right.
fn remove_all(text: &str, find: Matcher) -> String {
    let bytes = text.as_bytes();
    let mut out = String::with_capacity(text.len());
    let mut copied = 0;
    let mut from = 0;
    while let Some((start, end)) = find(bytes, from) {
        out.push_str(text.get(copied..start).unwrap_or_default());
        copied = end;
        from = end;
    }
    out.push_str(text.get(copied..).unwrap_or_default());
    out
}

/// DCS, SOS, PM and APC strings: `ESC [PX^_]` up to `ESC \`.
///
/// Sixel images and tmux passthrough carry arbitrary payloads, so they are
/// removed before anything else looks for a shorter sequence inside them.
fn string_sequence(bytes: &[u8], from: usize) -> Option<(usize, usize)> {
    let mut at = from;
    while let Some(open) = next_index(bytes, at, ESC) {
        if matches!(
            bytes.get(open + 1).copied(),
            Some(b'P' | b'X' | b'^' | b'_')
        ) {
            // With no terminator after this opener, no later opener has one either.
            let close = next_pair(bytes, open + 2, ESC, b'\\')?;
            return Some((open, close + 2));
        }
        at = open + 1;
    }
    None
}

/// OSC sequences `ESC ] ...` closed by BEL or `ESC \`.
fn osc_sequence(bytes: &[u8], from: usize) -> Option<(usize, usize)> {
    let mut at = from;
    while let Some(open) = next_index(bytes, at, ESC) {
        if bytes.get(open + 1).copied() == Some(b']') {
            let body = open + 2;
            let stop = bytes
                .get(body..)
                .unwrap_or_default()
                .iter()
                .position(|&b| b == BEL || b == ESC)
                .map_or(bytes.len(), |offset| body + offset);
            match bytes.get(stop).copied() {
                Some(BEL) => return Some((open, stop + 1)),
                Some(ESC) if bytes.get(stop + 1).copied() == Some(b'\\') => {
                    return Some((open, stop + 2));
                }
                _ => {}
            }
        }
        at = open + 1;
    }
    None
}

/// CSI sequences: `ESC [`, parameter bytes, intermediate bytes, one final byte.
fn csi_sequence(bytes: &[u8], from: usize) -> Option<(usize, usize)> {
    let mut at = from;
    while let Some(open) = next_index(bytes, at, ESC) {
        if bytes.get(open + 1).copied() == Some(b'[') {
            let params = skip_bytes(bytes, open + 2, 0x30..=0x3F);
            let intermediates = skip_bytes(bytes, params, 0x20..=0x2F);
            if bytes
                .get(intermediates)
                .is_some_and(|b| (0x40..=0x7E).contains(b))
            {
                return Some((open, intermediates + 1));
            }
        }
        at = open + 1;
    }
    None
}

/// Everything else ECMA-48 allows: `ESC`, intermediate bytes, then an optional
/// final byte. Covers a bare trailing escape left by a truncated copy.
fn simple_sequence(bytes: &[u8], from: usize) -> Option<(usize, usize)> {
    let open = next_index(bytes, from, ESC)?;
    let intermediates = skip_bytes(bytes, open + 1, 0x20..=0x2F);
    let end = if bytes
        .get(intermediates)
        .is_some_and(|b| (0x30..=0x7E).contains(b))
    {
        intermediates + 1
    } else {
        intermediates
    };
    Some((open, end))
}

/// Control characters with no meaning in a note. Tab, newline and carriage
/// return are kept: they carry layout.
fn is_stray_control(ch: char) -> bool {
    matches!(
        ch,
        '\u{00}'..='\u{08}' | '\u{0B}' | '\u{0C}' | '\u{0E}'..='\u{1F}' | '\u{7F}'
    )
}

/// The index of the next `byte` at or after `from`.
fn next_index(bytes: &[u8], from: usize, byte: u8) -> Option<usize> {
    bytes
        .get(from..)?
        .iter()
        .position(|&b| b == byte)
        .map(|offset| from + offset)
}

/// The index of the next two-byte pair `first second` at or after `from`.
fn next_pair(bytes: &[u8], from: usize, first: u8, second: u8) -> Option<usize> {
    bytes
        .get(from..)?
        .windows(2)
        .position(|pair| matches!(pair, [a, b] if *a == first && *b == second))
        .map(|offset| from + offset)
}

/// The first index at or after `from` whose byte is outside `range`.
fn skip_bytes(bytes: &[u8], from: usize, range: RangeInclusive<u8>) -> usize {
    let mut at = from;
    while bytes.get(at).is_some_and(|b| range.contains(b)) {
        at += 1;
    }
    at
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    #[test]
    fn colour_and_reset_sequences_are_removed() {
        assert_eq!(
            strip_control_sequences("\u{1B}[31merror\u{1B}[0m\u{7}"),
            "error"
        );
    }

    #[test]
    fn tab_newline_and_carriage_return_are_kept() {
        assert_eq!(strip_control_sequences("plain\ttext\n"), "plain\ttext\n");
        assert_eq!(strip_control_sequences("a\r\nb"), "a\r\nb");
    }

    #[test]
    fn stray_control_characters_are_removed() {
        assert_eq!(strip_control_sequences("a\u{0}b\u{8}c\u{7F}d"), "abcd");
    }

    #[test]
    fn osc_title_is_removed_up_to_bel() {
        assert_eq!(strip_control_sequences("\u{1B}]0;title\u{7}ok"), "ok");
    }

    #[test]
    fn string_sequence_payload_is_removed_whole() {
        // The payload holds a `[` that a shorter pattern would have matched first.
        assert_eq!(
            strip_control_sequences("\u{1B}Pq#0;2;0[31m\u{1B}\\text"),
            "text"
        );
    }

    #[test]
    fn charset_selection_and_bare_escape_are_removed() {
        assert_eq!(strip_control_sequences("a\u{1B}(Bb"), "ab");
        assert_eq!(strip_control_sequences("x\u{1B}"), "x");
    }

    #[test]
    fn unterminated_string_falls_through_to_simple_rule() {
        assert_eq!(strip_control_sequences("\u{1B}Pabc"), "abc");
    }

    #[test]
    fn empty_and_non_ascii_text() {
        assert_eq!(strip_control_sequences(""), "");
        assert_eq!(
            strip_control_sequences("héllo\u{1B}[1m wörld"),
            "héllo wörld"
        );
    }
}
