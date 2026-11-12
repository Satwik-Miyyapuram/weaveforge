//! Maths detection for the markdown renderer (TS: `components/markdown/math-renderer.ts`).

/// Whether this text has anything the renderer would treat as maths (TS `containsMath`).
///
/// Mirrors the delimiters the renderer recognises: `$$…$$`, a single-line `$…$`, `\(` and `\[`.
/// A backslash-escaped `$` is not a delimiter. Deliberately conservative: an unclosed `$` counts,
/// and the renderer decides what to do with it.
#[must_use]
pub fn contains_math(md: &str) -> bool {
    if md.contains("\\(") || md.contains("\\[") {
        return true;
    }
    let bytes = md.as_bytes();
    bytes
        .iter()
        .enumerate()
        .any(|(i, &b)| b == b'$' && (i == 0 || bytes[i - 1] != b'\\'))
}

#[cfg(test)]
mod tests {
    use super::contains_math;

    #[test]
    // it: "only text with maths triggers the load"
    fn only_text_with_maths_triggers_the_load() {
        assert!(contains_math("Just prose about $5 and a shell $VAR."), "a bare dollar counts");
        assert!(contains_math("$$\\int_0^1 x\\,dx$$"));
        assert!(!contains_math("Escaped: \\$5 only."), "an escaped dollar is not a delimiter");
        assert!(!contains_math("No maths here at all."));
    }

    #[test]
    // it: "containsMath recognises the bracketed delimiters too"
    fn contains_math_recognises_the_bracketed_delimiters_too() {
        assert!(contains_math("\\(x\\)"));
        assert!(contains_math("\\[x\\]"));
        assert!(contains_math("plain text with a \\(escaped-looking word"));
        assert!(!contains_math("no maths here"));
    }
}
