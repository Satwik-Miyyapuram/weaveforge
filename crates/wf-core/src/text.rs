//! Plain-text helpers. Port of `countWords` in `packages/core/src/shared/text.ts`. Pure.

/// Words in plain text: runs of non-whitespace. The JS `\s` class also counts the
/// byte-order mark, so it is treated as a separator here too.
#[must_use]
pub fn count_words(text: &str) -> usize {
    text.split(|c: char| c.is_whitespace() || c == '\u{feff}')
        .filter(|word| !word.is_empty())
        .count()
}

/// Text made safe inside HTML or XML markup: `&`, `<`, `>` and `"`. Ported from
/// `apps/web/src/lib/escape-html.ts`. One pass, so an `&` in the input is escaped
/// once and never re-read.
#[must_use]
pub fn escape_html(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for c in value.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            other => out.push(other),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::{count_words, escape_html};

    #[test]
    fn escapes_the_four_markup_characters_once() {
        assert_eq!(
            escape_html("a & b <i>\"x\"</i>"),
            "a &amp; b &lt;i&gt;&quot;x&quot;&lt;/i&gt;"
        );
        assert_eq!(escape_html("&amp;"), "&amp;amp;");
        assert_eq!(escape_html("plain"), "plain");
    }

    #[test]
    fn counts_runs_of_non_whitespace() {
        assert_eq!(count_words("one two  three\nfour\tfive"), 5);
    }

    #[test]
    fn blank_and_padded_text() {
        assert_eq!(count_words(""), 0);
        assert_eq!(count_words("   \n\t "), 0);
        assert_eq!(count_words("  padded  "), 1);
    }

    #[test]
    fn byte_order_mark_is_a_separator() {
        assert_eq!(count_words("\u{feff}alpha\u{feff}beta"), 2);
    }
}
