//! Port of `mayOpenExternally` in apps/desktop/src/handlers.ts. Pure.
//!
//! The URL is handed to the operating system, so only a web address may pass. This reuses
//! [`check_url_shape`] (the fetch guard's scheme, port and credential check) rather than restating
//! it, so there is one answer to "is this a web address".
//!
//! Parity with the TS path it replaces (`checkUrlShape` -> `parseUserUrl`): the input is trimmed,
//! and text with no scheme is parsed as `https://<text>`, so a bare host such as `example.com` is
//! allowed, as it was before.

use url::Url;

use super::url_safety::check_url_shape;

/// True when the string is a web address the shell may hand to the operating system.
#[must_use]
pub fn may_open_externally(url: &str) -> bool {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return false;
    }
    let candidate = if has_scheme(trimmed) {
        trimmed.to_owned()
    } else {
        format!("https://{trimmed}")
    };
    let Ok(parsed) = Url::parse(&candidate) else {
        return false;
    };
    let protocol = format!("{}:", parsed.scheme());
    let has_credentials =
        !parsed.username().is_empty() || !parsed.password().unwrap_or("").is_empty();
    let port = parsed
        .port()
        .map_or_else(String::new, |port| port.to_string());
    check_url_shape(
        &protocol,
        has_credentials,
        &port,
        parsed.host_str().unwrap_or(""),
    )
    .ok
}

/// The TS `/^[a-z][a-z0-9+.-]*:/i` test: a letter, then letters, digits, `+`, `.` or `-`, then `:`.
fn has_scheme(text: &str) -> bool {
    let mut chars = text.chars();
    if !matches!(chars.next(), Some(first) if first.is_ascii_alphabetic()) {
        return false;
    }
    for c in chars {
        if c == ':' {
            return true;
        }
        if !(c.is_ascii_alphanumeric() || matches!(c, '+' | '.' | '-')) {
            return false;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_web_address_may_be_handed_to_the_operating_system() {
        assert!(may_open_externally("https://example.com/paper"));
        assert!(may_open_externally("http://example.com/paper"));
        assert!(may_open_externally("https://example.com:8443/paper"));
    }

    #[test]
    fn a_bare_host_is_read_as_https_as_the_ts_did() {
        assert!(may_open_externally("example.com"));
        assert!(may_open_externally("  example.com/paper  "));
        assert!(!may_open_externally(""));
        assert!(!may_open_externally("   "));
    }

    #[test]
    fn a_bare_host_on_a_blocked_suffix_is_refused() {
        assert!(!may_open_externally("printer.local"));
        assert!(!may_open_externally("intranet.internal/page"));
        assert!(!may_open_externally("app.localhost"));
    }

    #[test]
    fn a_non_http_scheme_is_refused() {
        assert!(!may_open_externally("ftp://example.com/file"));
        assert!(!may_open_externally("mailto:someone@example.com"));
        assert!(!may_open_externally("ms-msdt:/id"));
    }

    #[test]
    fn anything_that_would_run_something_local_is_refused() {
        for hostile in [
            "file:///etc/passwd",
            "javascript:alert(1)",
            "vscode://file/etc/passwd",
            "ms-msdt:/id",
            "https://user:pass@example.com/",
            "https://user@example.com/",
            "https://example.com:3000/",
            "https://localhost/",
            "https://127.0.0.1/",
            "not a url at all",
        ] {
            assert!(!may_open_externally(hostile), "{hostile}");
        }
    }
}
