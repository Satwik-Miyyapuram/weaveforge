//! Browser network failures, recognised from the error message.
//!
//! Chrome says "Failed to fetch", Firefox "NetworkError when attempting to
//! fetch resource." and Safari "Load failed". All three mean the request never
//! reached a server. Matching is ASCII-case-insensitive and word-bounded, so
//! "Upload failed" is not mistaken for "Load failed" (the JS original is
//! `/\b(failed to fetch|networkerror|load failed)\b/i`).

/// The phrases that name a network failure, lower-case ASCII.
const PHRASES: [&str; 3] = ["failed to fetch", "networkerror", "load failed"];

/// Whether `message` names a browser network failure.
#[must_use]
pub fn is_network_failure(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    PHRASES.iter().any(|phrase| contains_word(&lower, phrase))
}

/// Whether `needle` occurs in `haystack` with a non-word byte (or an edge) on
/// both sides, matching JavaScript's ASCII-only `\b`.
fn contains_word(haystack: &str, needle: &str) -> bool {
    let bytes = haystack.as_bytes();
    let mut from = 0;
    while let Some(offset) = haystack[from..].find(needle) {
        let start = from + offset;
        let end = start + needle.len();
        let before_ok = start == 0 || !is_word_byte(bytes[start - 1]);
        let after_ok = end == bytes.len() || !is_word_byte(bytes[end]);
        if before_ok && after_ok {
            return true;
        }
        // `start` is an ASCII match, so `start + 1` is a char boundary.
        from = start + 1;
    }
    false
}

/// JavaScript `\w` for the ASCII range. Non-ASCII bytes are non-word, as in JS.
const fn is_word_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_'
}

#[cfg(test)]
mod tests {
    use super::is_network_failure;

    #[test]
    fn recognises_the_three_browser_phrasings() {
        assert!(is_network_failure("Failed to fetch"));
        assert!(is_network_failure(
            "NetworkError when attempting to fetch resource."
        ));
        assert!(is_network_failure("Load failed"));
    }

    #[test]
    fn needs_word_boundaries() {
        assert!(!is_network_failure("Upload failed"));
        assert!(!is_network_failure("myNetworkErrorish"));
        assert!(is_network_failure("TypeError: failed to fetch (api)"));
    }

    #[test]
    fn ordinary_messages_are_not_network_failures() {
        assert!(!is_network_failure("Permission denied"));
        assert!(!is_network_failure(""));
    }
}
