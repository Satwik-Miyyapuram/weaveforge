//! Redact secrets and personal data from an error report before it leaves the app.
//!
//! Redaction is by shape and subtractive: rules run in a fixed order, and a
//! sensitive-shaped span is removed before a generic-shaped one can mangle it.

use std::sync::LazyLock;

use regex_lite::Regex;

/// The most text a single report field may carry, after redaction.
pub const MAX_REPORT_CHARS: usize = 8_000;

/// Rules in the order they run. Each replacement may reference group 1.
const RULE_SOURCES: [(&str, &str); 9] = [
    // A JWT: three long base64url segments.
    (
        r#"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b"#,
        "<jwt>",
    ),
    // An Authorization header in any casing, whatever scheme it carries.
    (
        r#"(?i)\b(bearer|basic|token)\s+[A-Za-z0-9._~+/=-]{8,}"#,
        "${1} <redacted>",
    ),
    // Provider key prefixes that identify themselves.
    (
        r#"\b(sbp_|ghp_|gho_|ghu_|ghs_|ghr_|github_pat_|xox[baprs]-)[A-Za-z0-9_-]{8,}"#,
        "<key>",
    ),
    // `sk-` needs the length rule because it collides with ordinary prose.
    (r#"\bsk-[A-Za-z0-9_-]{16,}"#, "<key>"),
    // A credential in a query string; keeps the parameter name.
    (
        r#"(?i)([?&](?:key|token|access_token|refresh_token|apikey|api_key|secret|code|password|signature)=)[^&\s"']+"#,
        "${1}<redacted>",
    ),
    // An absolute home directory; the account name is the leaf.
    (
        r#"([A-Za-z]:\\Users\\|/Users/|/home/|/var/folders/[^/]+/)[^\\/\s"']+"#,
        "${1}<user>",
    ),
    // An email address.
    (r#"\b[\w.%+-]+@[\w-]+\.[\w.-]{2,}\b"#, "<email>"),
    // A long opaque base64 or hex blob; forty characters is above any identifier.
    (r#"\b[A-Za-z0-9+/]{40,}={0,2}\b"#, "<blob>"),
    (r#"(?i)\b[0-9a-f]{40,}\b"#, "<blob>"),
];

/// Compiled rules. A pattern that fails to compile is skipped, never a panic.
static RULES: LazyLock<Vec<(Regex, &'static str)>> = LazyLock::new(|| {
    RULE_SOURCES
        .iter()
        .filter_map(|(pattern, replacement)| Regex::new(pattern).ok().map(|re| (re, *replacement)))
        .collect()
});

/// Redacted text and how many spans were replaced.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Redacted {
    /// The text after redaction and any truncation.
    pub text: String,
    /// How many spans were replaced, so a caller can say "12 items redacted".
    pub redactions: usize,
}

/// Redact every sensitive span in `input`, counting each match.
#[must_use]
pub fn redact(input: &str) -> Redacted {
    let mut text = input.to_owned();
    let mut redactions = 0;
    for (re, replacement) in RULES.iter() {
        let found = re.find_iter(&text).count();
        if found == 0 {
            continue;
        }
        redactions += found;
        text = re.replace_all(&text, *replacement).into_owned();
    }
    Redacted { text, redactions }
}

/// Redact, then keep the result to `limit` UTF-16 units, announcing any cut.
#[must_use]
pub fn redact_and_cap(input: &str, limit: usize) -> Redacted {
    let Redacted { text, redactions } = redact(input);
    let len = utf16_len(&text);
    if len <= limit {
        return Redacted { text, redactions };
    }
    let prefix = utf16_prefix(&text, limit);
    Redacted {
        text: format!(
            "{prefix}\n\n… truncated at {limit} characters ({} more)",
            len - limit
        ),
        redactions,
    }
}

/// Length in UTF-16 code units, as JavaScript's `.length` counts it.
fn utf16_len(s: &str) -> usize {
    s.encode_utf16().count()
}

/// The longest prefix of `s` within `limit` UTF-16 units, never splitting a char.
fn utf16_prefix(s: &str, limit: usize) -> &str {
    let mut units = 0;
    for (idx, ch) in s.char_indices() {
        let next = units + ch.len_utf16();
        if next > limit {
            return &s[..idx];
        }
        units = next;
    }
    s
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    #[test]
    fn jwt_is_replaced_before_generic_rules() {
        let out = redact("session eyJhbGciOiJI.payloadpart1.sigsigsig9 end");
        assert_eq!(out.text, "session <jwt> end");
        assert_eq!(out.redactions, 1);
    }

    #[test]
    fn authorization_header_keeps_scheme() {
        let out = redact("Authorization: Bearer abcdefghijk123");
        assert_eq!(out.text, "Authorization: Bearer <redacted>");
        assert_eq!(out.redactions, 1);
    }

    #[test]
    fn provider_prefix_key_is_replaced() {
        let out = redact("key ghp_abcdefghij12 here");
        assert_eq!(out.text, "key <key> here");
        assert_eq!(out.redactions, 1);
    }

    #[test]
    fn sk_key_needs_sixteen_characters() {
        let out = redact("sk-abcdefghijklmnop1234");
        assert_eq!(out.text, "<key>");
        assert_eq!(out.redactions, 1);
    }

    #[test]
    fn query_credential_keeps_parameter_name() {
        let out = redact("GET https://x.test/a?token=abc123&x=1");
        assert_eq!(out.text, "GET https://x.test/a?token=<redacted>&x=1");
        assert_eq!(out.redactions, 1);
    }

    #[test]
    fn home_directories_keep_prefix() {
        let out = redact(r"at C:\Users\sam\proj\a.rs and /home/sam/b");
        assert_eq!(out.text, r"at C:\Users\<user>\proj\a.rs and /home/<user>/b");
        assert_eq!(out.redactions, 2);
    }

    #[test]
    fn email_is_replaced() {
        let out = redact("mail sam.t+x@uni-delft.nl now");
        assert_eq!(out.text, "mail <email> now");
        assert_eq!(out.redactions, 1);
    }

    #[test]
    fn long_base64_blob_is_replaced() {
        let out = redact("blob abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN");
        assert_eq!(out.text, "blob <blob>");
        assert_eq!(out.redactions, 1);
    }

    #[test]
    fn long_hex_is_replaced_by_blob_rule() {
        // The base64 rule already covers hex, so the hex rule never adds a match.
        let hex = "0123456789abcdef".repeat(3);
        let out = redact(&hex);
        assert_eq!(out.text, "<blob>");
        assert_eq!(out.redactions, 1);
    }

    #[test]
    fn clean_text_is_unchanged() {
        let out = redact("nothing secret here");
        assert_eq!(out.text, "nothing secret here");
        assert_eq!(out.redactions, 0);
    }

    #[test]
    fn counts_sum_across_rules() {
        let out = redact("Bearer abcdefghijk123 and sk-abcdefghijklmnop1234");
        assert_eq!(out.text, "Bearer <redacted> and <key>");
        assert_eq!(out.redactions, 2);
    }

    #[test]
    fn cap_leaves_short_text_alone() {
        let out = redact_and_cap("hello", 10);
        assert_eq!(out.text, "hello");
        assert_eq!(out.redactions, 0);
    }

    #[test]
    fn cap_truncates_and_announces_cut() {
        let out = redact_and_cap("abcdefghij", 4);
        assert_eq!(out.text, "abcd\n\n… truncated at 4 characters (6 more)");
    }

    #[test]
    fn cap_does_not_split_non_bmp_char() {
        // The emoji is two UTF-16 units, so a cut at 2 keeps only "a".
        let out = redact_and_cap("a\u{1F600}b", 2);
        assert_eq!(out.text, "a\n\n… truncated at 2 characters (2 more)");
    }

    #[test]
    fn utf16_helpers_count_surrogates() {
        assert_eq!(utf16_len("a\u{1F600}"), 3);
        assert_eq!(utf16_prefix("a\u{1F600}b", 3), "a\u{1F600}");
        assert_eq!(utf16_prefix("a\u{1F600}b", 2), "a");
    }
}
