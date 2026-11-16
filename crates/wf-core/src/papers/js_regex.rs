//! Compiles a JS-style pattern with `regex-lite`, so it matches as the TS twin does.
//!
//! `regex-lite` treats `\s` as ASCII only, but JS `\s` also matches no-break
//! and other Unicode spaces. `\s`, `\S` and `[\s\S]` are spelled out here.
//! `\b`, `\d` and `(?i)` are ASCII in both, so they need no change.

use regex_lite::Regex;

/// The characters JS `\s` matches (ECMAScript WhiteSpace and LineTerminator).
const JS_SPACE: &str = "\t\n\u{0B}\u{0C}\r \u{A0}\u{1680}\u{2000}-\u{200A}\u{2028}\u{2029}\u{202F}\u{205F}\u{3000}\u{FEFF}";

/// Rewrites `[\s\S]`, `\S` and `\s` outside a class. Inside another class, spell them out by hand.
fn expand(pattern: &str) -> String {
    pattern
        .replace(r"[\s\S]", "(?s:.)")
        .replace(r"\S", &format!("[^{JS_SPACE}]"))
        .replace(r"\s", &format!("[{JS_SPACE}]"))
}

/// The class body for JS `\s`, to put inside a hand-written class.
pub(crate) fn space_class() -> &'static str {
    JS_SPACE
}

/// Compiles `pattern` after the JS rewrites above.
pub(crate) fn compile(pattern: &str) -> Result<Regex, regex_lite::Error> {
    Regex::new(&expand(pattern))
}

#[cfg(test)]
mod tests {
    use super::compile;

    #[test]
    fn space_matches_js_whitespace() {
        let re = compile(r"^\s+$").expect("compiles");
        assert!(re.is_match(" \t\n\u{A0}\u{2003}\u{3000}\u{FEFF}"));
        assert!(!re.is_match("a"));
    }

    #[test]
    fn non_space_excludes_no_break_space() {
        let re = compile(r"^\S+$").expect("compiles");
        assert!(re.is_match("abc"));
        assert!(!re.is_match("a\u{A0}b"));
    }

    #[test]
    fn any_char_crosses_lines() {
        let re = compile(r"^a[\s\S]*b$").expect("compiles");
        assert!(re.is_match("a\n\u{A0}x\nb"));
    }

    #[test]
    fn word_boundary_and_case_are_ascii() {
        let re = compile(r"(?i)\bmeta\b").expect("compiles");
        assert!(re.is_match("<META name>"));
        assert!(re.is_match("émeta"), "JS \\b sees é as a non-word char");
    }
}
