//! Local API tokens: generation, hashing, bearer checks and the stored list.
//!
//! Ported from `apps/shell/sidecar/src/local-api.ts` (`tokenMatches`, `grantPermissions`)
//! and `local-api-server.ts` (token helpers).

use serde_json::Value;
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;

use super::{Expected, Permission, TokenRecord};

/// How many local API tokens may be live at once.
pub const MAX_LOCAL_API_TOKENS: usize = 5;

/// A fresh token: 32 random bytes as 64 lowercase hex chars.
#[must_use]
pub fn new_local_api_token() -> String {
    random_hex(32)
}

/// sha256 hex of `token`. Only the hash is stored, so a token is never shown again.
#[must_use]
pub fn hash_local_api_token(token: &str) -> String {
    hex(&Sha256::digest(token.as_bytes()))
}

/// Whether `header` is exactly `Bearer <expected>`. Constant-time compare.
#[must_use]
pub fn token_matches(header: Option<&str>, expected: &str) -> bool {
    if expected.is_empty() {
        return false;
    }
    match bearer_token(header) {
        Some(offered) => offered.as_bytes().ct_eq(expected.as_bytes()).into(),
        None => false,
    }
}

/// Permissions of the live grant that matches `header`, or `None`.
///
/// Expiry is compared as strings, which orders `toISOString` UTC values like time.
/// Every live match gets `used_at`; the last match's permissions win, as in the TS.
#[must_use]
pub fn grant_permissions(
    header: Option<&str>,
    expected: &mut Expected,
    now_ms: u64,
    now_iso: &str,
) -> Option<Vec<Permission>> {
    match expected {
        Expected::Single(token) => {
            token_matches(header, token.as_str()).then(|| Permission::ALL.to_vec())
        }
        Expected::Grants(records) => {
            let offered = bearer_token(header)?;
            let digest = Sha256::digest(offered.as_bytes());
            let mut found = None;
            for record in records.iter_mut() {
                let Some(hash) = decode_hex(&record.hash) else {
                    continue;
                };
                if !bool::from(digest.as_slice().ct_eq(hash.as_slice())) {
                    continue;
                }
                if record
                    .expires_at
                    .as_deref()
                    .is_some_and(|exp| !exp.is_empty() && exp <= now_iso)
                {
                    continue;
                }
                found = Some(record.permissions.clone());
                record.used_at = Some(now_ms);
            }
            found
        }
    }
}

/// A new token and its stored record. Only the record's hash is kept.
#[must_use]
pub fn make_local_api_token(
    name: &str,
    permissions: &[Permission],
    expires_at: Option<String>,
    now_iso: &str,
) -> (String, TokenRecord) {
    let token = new_local_api_token();
    let record = TokenRecord {
        id: random_hex(8),
        name: name.to_owned(),
        hash: hash_local_api_token(&token),
        prefix: token[..6].to_owned(),
        permissions: permissions.to_vec(),
        created_at: now_iso.to_owned(),
        expires_at,
        used_at: None,
        legacy: false,
    };
    (token, record)
}

/// The stored list. A legacy bare 64-hex token becomes one `legacy` record with every permission.
///
/// Entries missing `id`, `name`, `hash` or `permissions` are dropped, as in the TS. Entries
/// that also fail to deserialize (missing `prefix`/`createdAt`, unknown permission) are dropped too.
#[must_use]
pub fn parse_local_api_tokens(raw: &str) -> Vec<TokenRecord> {
    if let Ok(Value::Array(items)) = serde_json::from_str::<Value>(raw) {
        return items
            .into_iter()
            .filter(is_token_shape)
            .filter_map(|item| serde_json::from_value(item).ok())
            .collect();
    }
    if !is_legacy_token(raw) {
        return Vec::new();
    }
    vec![TokenRecord {
        id: "legacy".to_owned(),
        name: "Token 1".to_owned(),
        hash: hash_local_api_token(raw),
        prefix: raw[..6].to_owned(),
        permissions: Permission::ALL.to_vec(),
        created_at: "1970-01-01T00:00:00.000Z".to_owned(),
        expires_at: None,
        used_at: None,
        legacy: true,
    }]
}

/// The bearer token in `header`: non-empty, and no line breaks (JS `.` and `$`).
fn bearer_token(header: Option<&str>) -> Option<&str> {
    let offered = header?.strip_prefix("Bearer ")?;
    let line_break = offered
        .chars()
        .any(|c| matches!(c, '\n' | '\r' | '\u{2028}' | '\u{2029}'));
    (!offered.is_empty() && !line_break).then_some(offered)
}

fn is_token_shape(item: &Value) -> bool {
    item.as_object().is_some_and(|o| {
        o.get("id").is_some_and(Value::is_string)
            && o.get("name").is_some_and(Value::is_string)
            && o.get("hash").is_some_and(Value::is_string)
            && o.get("permissions").is_some_and(Value::is_array)
    })
}

fn is_legacy_token(raw: &str) -> bool {
    raw.len() == 64 && raw.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

/// `n` random bytes as lowercase hex. Aborts when the OS has no randomness.
fn random_hex(n: usize) -> String {
    let mut buf = vec![0u8; n];
    if getrandom::fill(&mut buf).is_err() {
        // no randomness means no safe token
        std::process::abort();
    }
    hex(&buf)
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// A 64-char hex string as its 32 bytes; `None` for anything else.
fn decode_hex(s: &str) -> Option<Vec<u8>> {
    if s.len() != 64 || !s.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    (0..64)
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).ok())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW_ISO: &str = "2026-11-05T10:00:00.000Z";
    const NOW_MS: u64 = 1_000;

    fn token() -> String {
        "a".repeat(64)
    }

    fn bearer(token: &str) -> String {
        format!("Bearer {token}")
    }

    fn is_hex64(s: &str) -> bool {
        s.len() == 64 && s.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
    }

    fn grant(permissions: Vec<Permission>, expires_at: Option<&str>) -> TokenRecord {
        TokenRecord {
            id: "g".to_owned(),
            name: "g".to_owned(),
            hash: hash_local_api_token(&token()),
            prefix: "aaaaaa".to_owned(),
            permissions,
            created_at: NOW_ISO.to_owned(),
            expires_at: expires_at.map(str::to_owned),
            used_at: None,
            legacy: false,
        }
    }

    // local-api.test.ts: "no token has been generated, so nothing authenticates"
    #[test]
    fn empty_expected_or_missing_header_never_matches() {
        assert!(!token_matches(Some(&bearer(&token())), ""));
        assert!(!token_matches(None, &token()));
    }

    // local-api.test.ts: "a request with no token is refused before anything is read"
    #[test]
    fn missing_header_is_refused() {
        assert!(!token_matches(None, &token()));
    }

    // local-api.test.ts: "a wrong token of the right length is refused"
    #[test]
    fn wrong_token_of_right_length_is_refused() {
        assert!(!token_matches(Some(&bearer(&"b".repeat(64))), &token()));
    }

    #[test]
    fn exact_bearer_matches() {
        assert!(token_matches(Some(&bearer(&token())), &token()));
    }

    #[test]
    fn wrong_scheme_is_refused() {
        assert!(!token_matches(
            Some(&format!("Basic {}", token())),
            &token()
        ));
        assert!(!token_matches(
            Some(&format!("bearer {}", token())),
            &token()
        ));
    }

    #[test]
    fn empty_header_is_refused() {
        assert!(!token_matches(Some(""), &token()));
        assert!(!token_matches(Some("Bearer "), &token()));
    }

    #[test]
    fn line_break_in_header_is_refused() {
        assert!(!token_matches(
            Some(&format!("{}\n", bearer(&token()))),
            &token()
        ));
    }

    #[test]
    fn single_token_grants_every_permission() {
        let mut expected = Expected::Single(token());
        assert_eq!(
            grant_permissions(Some(&bearer(&token())), &mut expected, NOW_MS, NOW_ISO),
            Some(Permission::ALL.to_vec())
        );
        assert_eq!(
            grant_permissions(Some(&bearer("b")), &mut expected, NOW_MS, NOW_ISO),
            None
        );
    }

    #[test]
    fn live_grant_returns_its_permissions_and_sets_used_at() {
        let mut expected = Expected::Grants(vec![grant(vec![Permission::RestRead], None)]);
        assert_eq!(
            grant_permissions(Some(&bearer(&token())), &mut expected, NOW_MS, NOW_ISO),
            Some(vec![Permission::RestRead])
        );
        let Expected::Grants(records) = &expected else {
            panic!("grants")
        };
        assert_eq!(records[0].used_at, Some(NOW_MS));
    }

    // local-api.test.ts: "an expired token is refused"
    #[test]
    fn expired_grant_is_refused() {
        let mut expected = Expected::Grants(vec![grant(
            vec![Permission::RestRead],
            Some("2000-01-01T00:00:00Z"),
        )]);
        assert_eq!(
            grant_permissions(Some(&bearer(&token())), &mut expected, NOW_MS, NOW_ISO),
            None
        );
        let Expected::Grants(records) = &expected else {
            panic!("grants")
        };
        assert_eq!(records[0].used_at, None);
    }

    #[test]
    fn grant_expiring_later_is_accepted() {
        let mut expected = Expected::Grants(vec![grant(
            vec![Permission::McpRead],
            Some("2999-01-01T00:00:00.000Z"),
        )]);
        assert_eq!(
            grant_permissions(Some(&bearer(&token())), &mut expected, NOW_MS, NOW_ISO),
            Some(vec![Permission::McpRead])
        );
    }

    #[test]
    fn two_matching_grants_last_wins_and_both_get_used_at() {
        let mut expected = Expected::Grants(vec![
            grant(vec![Permission::RestRead], None),
            grant(vec![Permission::McpRead], None),
        ]);
        assert_eq!(
            grant_permissions(Some(&bearer(&token())), &mut expected, NOW_MS, NOW_ISO),
            Some(vec![Permission::McpRead])
        );
        let Expected::Grants(records) = &expected else {
            panic!("grants")
        };
        assert_eq!(records[0].used_at, Some(NOW_MS));
        assert_eq!(records[1].used_at, Some(NOW_MS));
    }

    #[test]
    fn expired_match_does_not_shadow_live_grant() {
        let mut expected = Expected::Grants(vec![
            grant(vec![Permission::McpRead], None),
            grant(vec![Permission::RestWrite], Some("2000-01-01T00:00:00Z")),
        ]);
        assert_eq!(
            grant_permissions(Some(&bearer(&token())), &mut expected, NOW_MS, NOW_ISO),
            Some(vec![Permission::McpRead])
        );
    }

    #[test]
    fn grants_refuse_missing_or_wrong_bearer() {
        let mut expected = Expected::Grants(vec![grant(vec![Permission::RestRead], None)]);
        assert_eq!(
            grant_permissions(None, &mut expected, NOW_MS, NOW_ISO),
            None
        );
        assert_eq!(
            grant_permissions(Some("Basic x"), &mut expected, NOW_MS, NOW_ISO),
            None
        );
        assert_eq!(
            grant_permissions(
                Some(&bearer(&"b".repeat(64))),
                &mut expected,
                NOW_MS,
                NOW_ISO
            ),
            None
        );
    }

    #[test]
    fn empty_grant_list_refuses_everything() {
        let mut expected = Expected::Grants(Vec::new());
        assert_eq!(
            grant_permissions(Some(&bearer(&token())), &mut expected, NOW_MS, NOW_ISO),
            None
        );
    }

    #[test]
    fn malformed_stored_hash_is_skipped() {
        let mut bad = grant(vec![Permission::RestRead], None);
        bad.hash = "zz".to_owned();
        let mut expected = Expected::Grants(vec![bad]);
        assert_eq!(
            grant_permissions(Some(&bearer(&token())), &mut expected, NOW_MS, NOW_ISO),
            None
        );
    }

    #[test]
    fn hash_is_sha256_hex() {
        assert_eq!(
            hash_local_api_token(""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[test]
    fn new_token_is_64_lowercase_hex_and_fresh() {
        let a = new_local_api_token();
        let b = new_local_api_token();
        assert!(is_hex64(&a));
        assert_ne!(a, b);
    }

    // local-api.test.ts: "stored tokens keep only a hash; a legacy plaintext token migrates with every permission"
    #[test]
    fn stored_record_keeps_only_hash() {
        let (token, record) = make_local_api_token("x", &[Permission::Experiments], None, NOW_ISO);
        assert_eq!(record.hash, hash_local_api_token(&token));
        assert!(
            !serde_json::to_string(&record)
                .expect("serializes")
                .contains(&token)
        );
        assert_eq!(record.prefix, &token[..6]);
        assert_eq!(record.id.len(), 16);
        assert_eq!(record.created_at, NOW_ISO);
        assert!(!record.legacy);
    }

    #[test]
    fn legacy_bare_token_migrates_with_every_permission() {
        let legacy = parse_local_api_tokens(&token());
        assert_eq!(legacy.len(), 1);
        let record = &legacy[0];
        assert!(record.legacy);
        assert_eq!(record.id, "legacy");
        assert_eq!(record.name, "Token 1");
        assert_eq!(record.permissions.len(), 5);
        assert_eq!(record.permissions, Permission::ALL.to_vec());
        assert_eq!(record.hash, hash_local_api_token(&token()));
        assert_eq!(record.created_at, "1970-01-01T00:00:00.000Z");
        assert_eq!(record.expires_at, None);
    }

    #[test]
    fn uppercase_bare_token_is_not_legacy() {
        assert!(parse_local_api_tokens(&token().to_uppercase()).is_empty());
    }

    #[test]
    fn stored_list_round_trips() {
        let (_, record) = make_local_api_token("x", &[Permission::Experiments], None, NOW_ISO);
        let json = serde_json::to_string(&vec![record.clone()]).expect("serializes");
        assert_eq!(parse_local_api_tokens(&json), vec![record]);
    }

    #[test]
    fn malformed_json_yields_nothing() {
        assert!(parse_local_api_tokens("[{").is_empty());
        assert!(parse_local_api_tokens("not json").is_empty());
        assert!(parse_local_api_tokens("").is_empty());
        assert!(parse_local_api_tokens("{}").is_empty());
        assert!(parse_local_api_tokens(&format!("\"{}\"", token())).is_empty());
    }

    #[test]
    fn non_object_and_mistyped_entries_are_dropped() {
        let raw = r#"[
            null,
            3,
            {"name":"n","hash":"h","permissions":[]},
            {"id":1,"name":"n","hash":"h","permissions":[]},
            {"id":"ok","name":"n","hash":"h","prefix":"abc","createdAt":"t","permissions":["rest:read"]}
        ]"#;
        let records = parse_local_api_tokens(raw);
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].id, "ok");
    }

    #[test]
    fn permissions_must_be_array_of_known_names() {
        let raw = r#"[
            {"id":"a","name":"n","hash":"h","prefix":"abc","createdAt":"t","permissions":"rest:read"},
            {"id":"b","name":"n","hash":"h","prefix":"abc","createdAt":"t","permissions":["admin"]},
            {"id":"c","name":"n","hash":"h","prefix":"abc","createdAt":"t","permissions":["rest:read"],"expiresAt":5}
        ]"#;
        assert!(parse_local_api_tokens(raw).is_empty());
    }
}
