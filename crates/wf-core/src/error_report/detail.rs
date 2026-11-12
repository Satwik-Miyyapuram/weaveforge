//! The detail block an error boundary shows and a report carries
//! (`apps/web/src/app/error-boundary-parts.ts`, `errorDetail`).
//!
//! The TypeScript caller reads the fields off the thrown `Error` (guarding the `stack` getter,
//! which may throw) and passes them in; the layout of the block lives here.

/// JavaScript's `String.prototype.trim` strips whitespace and the byte-order mark; Rust's
/// `str::trim` strips Unicode White_Space only, so the mark is added.
fn js_trim(text: &str) -> &str {
    text.trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}')
}

/// Message, digest and stack, one per line.
///
/// An empty or absent message gives `""` (nothing is invented). The digest line is added only when
/// the digest is non-empty. The stack is added as given (untrimmed) only when it is non-blank.
#[must_use]
pub fn error_detail(message: Option<&str>, digest: Option<&str>, stack: Option<&str>) -> String {
    let Some(message) = message.filter(|m| !m.is_empty()) else {
        return String::new();
    };
    let mut parts = vec![message.to_owned()];
    if let Some(digest) = digest.filter(|d| !d.is_empty()) {
        parts.push(format!("digest: {digest}"));
    }
    if let Some(stack) = stack.filter(|s| !js_trim(s).is_empty()) {
        parts.push(stack.to_owned());
    }
    parts.join("\n")
}

#[cfg(test)]
mod tests {
    use super::error_detail;

    #[test]
    // it: "errorDetail carries the message, the digest and the stack"
    fn error_detail_carries_message_digest_and_stack() {
        let detail = error_detail(
            Some("Cannot read properties of undefined (reading 'title')"),
            Some("1234567890"),
            Some("TypeError: Cannot read properties of undefined\n    at page (app.js:1:2)"),
        );
        assert!(detail.contains("Cannot read properties of undefined"));
        assert!(detail.contains("digest: 1234567890"));
        assert!(detail.contains("    at page (app.js:1:2)"));
        assert_eq!(
            detail,
            "Cannot read properties of undefined (reading 'title')\ndigest: 1234567890\nTypeError: Cannot read properties of undefined\n    at page (app.js:1:2)"
        );
    }

    #[test]
    // it: "errorDetail tolerates an error with no stack of its own"
    fn error_detail_tolerates_an_error_with_no_stack() {
        assert_eq!(
            error_detail(
                Some("An error occurred in the Server Components render"),
                Some("abc"),
                None
            ),
            "An error occurred in the Server Components render\ndigest: abc"
        );
    }

    #[test]
    // it: "errorDetail is empty rather than invented when there is no message"
    fn error_detail_is_empty_when_there_is_no_message() {
        assert_eq!(error_detail(Some(""), None, None), "");
        assert_eq!(error_detail(None, Some("abc"), Some("at x")), "");
    }

    #[test]
    fn error_detail_skips_a_blank_stack_and_an_empty_digest() {
        assert_eq!(error_detail(Some("boom"), Some(""), Some(" \t\n\u{feff}")), "boom");
    }
}
