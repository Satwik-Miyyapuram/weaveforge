//! Plain-text helpers. Port of `countWords` in `packages/core/src/shared/text.ts`. Pure.

/// Words in plain text: runs of non-whitespace. The JS `\s` class also counts the
/// byte-order mark, so it is treated as a separator here too.
#[must_use]
pub fn count_words(text: &str) -> usize {
    text.split(|c: char| c.is_whitespace() || c == '\u{feff}')
        .filter(|word| !word.is_empty())
        .count()
}

#[cfg(test)]
mod tests {
    use super::count_words;

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
