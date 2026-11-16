//! The Outline section: the headings of the document on screen. Ported from
//! `apps/web/src/features/editor-workspace/application/outline.ts`.
//!
//! Reads the same markdown the Read view renders, line by line: ATX headings
//! only, fenced code skipped, and the slug is the one the Read view writes.

use serde::{Deserialize, Serialize};

use crate::heading_slug::heading_slug;
use crate::search::js_text::is_js_whitespace;

/// One heading in the outline.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct OutlineHeading {
    /// The heading level, 1 to 6.
    #[cfg_attr(feature = "specta", specta(type = u32))]
    pub level: usize,
    /// The heading text, with the closing `#`s removed.
    pub text: String,
    /// The anchor `VaultMarkdown` gives the heading, so a click can scroll to it.
    pub slug: String,
}

/// Headings in document order, up to `max_level`.
///
/// A `# comment` inside a fenced block is not a heading, and listing it would
/// send the reader to a line that is not one. The closing `#`s count only after
/// a space, so `C#` keeps its `#`.
#[must_use]
pub fn outline_of(body: &str, max_level: usize) -> Vec<OutlineHeading> {
    let mut out = Vec::new();
    // The run that opened the current fence: its character and length.
    let mut fence: Option<(char, usize)> = None;
    for raw in body.replace("\r\n", "\n").split('\n') {
        let line = raw.trim_end_matches(is_js_whitespace);
        if let Some((open_char, open_len)) = fence {
            if let Some((marker_char, marker_len)) = fence_marker(line) {
                let trimmed = line.trim_matches(is_js_whitespace);
                let alone =
                    trimmed.len() == marker_len && trimmed.chars().all(|c| c == marker_char);
                if marker_char == open_char && marker_len >= open_len && alone {
                    fence = None;
                }
            }
            continue;
        }
        if let Some(marker) = fence_marker(line) {
            fence = Some(marker);
            continue;
        }
        let Some((level, group)) = atx_heading(line) else {
            continue;
        };
        if level > max_level {
            continue;
        }
        let text = group.trim_matches(is_js_whitespace);
        // "### #" is an empty heading whose only content is its closing sequence.
        if text.is_empty() || text.chars().all(|c| c == '#') {
            continue;
        }
        out.push(OutlineHeading {
            level,
            text: text.to_owned(),
            slug: heading_slug(text),
        });
    }
    out
}

/// A fence opener: optional indent, then three or more backticks or tildes.
fn fence_marker(line: &str) -> Option<(char, usize)> {
    let rest = line.trim_start_matches(is_js_whitespace);
    let ch = rest.chars().next().filter(|c| *c == '`' || *c == '~')?;
    let run = rest.chars().take_while(|&c| c == ch).count();
    (run >= 3).then_some((ch, run))
}

/// An ATX heading: 1 to 6 `#`, whitespace, then the text. Returns the level
/// and the text group before any closing `#` sequence, untrimmed.
fn atx_heading(line: &str) -> Option<(usize, &str)> {
    let hashes = line.chars().take_while(|&c| c == '#').count();
    if hashes == 0 || hashes > 6 {
        return None;
    }
    let rest = &line[hashes..];
    let after = rest.trim_start_matches(is_js_whitespace);
    // The `#`s must be followed by whitespace, and the text must not be empty.
    if after.len() == rest.len() || after.is_empty() {
        return None;
    }
    // The shortest non-empty text whose remainder is a closing sequence or nothing.
    for (index, ch) in after.char_indices() {
        let end = index + ch.len_utf8();
        if is_closing_tail(&after[end..]) {
            return Some((hashes, &after[..end]));
        }
    }
    None
}

/// `(?:\s+#+)?\s*$`: the remainder of an ATX line that closes the heading.
fn is_closing_tail(rest: &str) -> bool {
    let without_space = rest.trim_start_matches(is_js_whitespace);
    if without_space.len() == rest.len() {
        return rest.is_empty();
    }
    if without_space.is_empty() {
        return true;
    }
    let after_hashes = without_space.trim_start_matches('#');
    if after_hashes.len() == without_space.len() {
        return false;
    }
    after_hashes.chars().all(is_js_whitespace)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn texts(body: &str) -> Vec<String> {
        outline_of(body, 3).into_iter().map(|h| h.text).collect()
    }

    #[test]
    fn levels_up_to_max() {
        let headings = outline_of("# One\n\ntext\n\n## Two\n\n### Three\n\n#### Too deep", 3);
        let levels: Vec<usize> = headings.iter().map(|h| h.level).collect();
        assert_eq!(levels, [1, 2, 3]);
        assert_eq!(headings[1].slug, heading_slug("Two"));
    }

    #[test]
    fn fenced_code_is_skipped() {
        assert_eq!(
            texts("# Real\n\n```sh\n# not a heading\n```\n\n## Also real"),
            ["Real", "Also real"]
        );
    }

    #[test]
    fn closing_hashes_only_after_space() {
        assert_eq!(
            texts("## Learning C#\n\n## Closed ##\n\n# Issue #12\n\n### #"),
            ["Learning C#", "Closed", "Issue #12"]
        );
    }

    #[test]
    fn prose_and_empty_body_have_no_outline() {
        assert!(outline_of("just prose\nand more", 3).is_empty());
        assert!(outline_of("", 3).is_empty());
    }

    #[test]
    fn longer_fence_only_closes_on_its_own_marker() {
        let body = "````md\n```\n# hidden\n```\n````\n# Shown";
        assert_eq!(texts(body), ["Shown"]);
    }
}
