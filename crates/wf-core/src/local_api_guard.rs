//! Request guards for the local API (TS `apps/shell/sidecar/src/local-api-server.ts` `isLoopbackHost` and
//! the legacy-token check in `parseLocalApiTokens`, and `local-api.ts` `tokenMatches`' header parse).
//! The constant-time token comparison stays in TypeScript (`timingSafeEqual`), and so do hashing and
//! random token generation (`node:crypto`).

/// Whether a `Host` header names this machine on `port`: the three spellings a loopback page can use.
/// The header is trimmed and lowercased first, as TS `isLoopbackHost` does; a missing header is never loopback.
pub fn is_loopback_host(host: Option<&str>, port: u16) -> bool {
    let Some(host) = host else {
        return false;
    };
    let name = host.trim().to_lowercase();
    name == format!("127.0.0.1:{port}")
        || name == format!("localhost:{port}")
        || name == format!("[::1]:{port}")
}

/// The token a `Bearer` authorization header offers (TS `tokenMatches`: `/^Bearer (.+)$/`).
/// `None` when the header is missing, is not a bearer credential, or the token is empty. Like the JS `.`,
/// the token may not contain a line terminator.
pub fn bearer_token(header: Option<&str>) -> Option<&str> {
    let rest = header?.strip_prefix("Bearer ")?;
    if rest.is_empty()
        || rest
            .chars()
            .any(|c| matches!(c, '\n' | '\r' | '\u{2028}' | '\u{2029}'))
    {
        return None;
    }
    Some(rest)
}

/// Whether a stored local-API token string is a legacy plaintext token: 64 lowercase hex characters
/// (TS `parseLocalApiTokens`' `/^[0-9a-f]{64}$/`). Such a value is hashed and the store rewritten.
pub fn is_legacy_token_hex(stored: &str) -> bool {
    stored.len() == 64
        && stored
            .bytes()
            .all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loopback_accepts_the_three_spellings_on_the_port() {
        assert!(is_loopback_host(Some("127.0.0.1:27123"), 27123));
        assert!(is_loopback_host(Some("localhost:27123"), 27123));
        assert!(is_loopback_host(Some("[::1]:27123"), 27123));
    }

    #[test]
    fn loopback_trims_and_lowercases_the_header() {
        assert!(is_loopback_host(Some("  LOCALHOST:27123 "), 27123));
    }

    #[test]
    fn loopback_rejects_other_ports_hosts_and_missing_headers() {
        assert!(!is_loopback_host(Some("localhost:8080"), 27123));
        assert!(!is_loopback_host(Some("localhost"), 27123));
        assert!(!is_loopback_host(Some("evil.example:27123"), 27123));
        assert!(!is_loopback_host(Some("127.0.0.2:27123"), 27123));
        assert!(!is_loopback_host(None, 27123));
    }

    #[test]
    fn bearer_token_returns_the_credential() {
        assert_eq!(bearer_token(Some("Bearer abc123")), Some("abc123"));
    }

    #[test]
    fn bearer_token_rejects_other_schemes_empty_and_multiline_values() {
        assert_eq!(bearer_token(Some("Basic abc")), None);
        assert_eq!(bearer_token(Some("bearer abc")), None);
        assert_eq!(bearer_token(Some("Bearer ")), None);
        assert_eq!(bearer_token(Some("Bearer")), None);
        assert_eq!(bearer_token(Some("Bearer a\nb")), None);
        assert_eq!(bearer_token(None), None);
    }

    #[test]
    fn legacy_token_is_exactly_64_lowercase_hex() {
        assert!(is_legacy_token_hex(&"ab".repeat(32)));
        assert!(!is_legacy_token_hex(&"AB".repeat(32)));
        assert!(!is_legacy_token_hex(&"ab".repeat(31)));
        assert!(!is_legacy_token_hex(&format!("{}g", "ab".repeat(31))));
        assert!(!is_legacy_token_hex(&format!("{}\n", "ab".repeat(32))));
        assert!(!is_legacy_token_hex("{\"records\":[]}"));
    }
}
