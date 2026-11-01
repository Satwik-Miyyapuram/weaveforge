//! Pure helpers behind /api/settings/api-tokens and /api/settings/mcp-tokens: token generation, expiry and row mapping.
#![allow(clippy::unwrap_used, clippy::expect_used, missing_docs)]

use serde_json::{Value, json};
use wf_relay_server::api_tokens::{
    expiry_from_days, generate_token, is_expiry_days, map_row, token_from_bytes,
};

#[test]
fn token_from_bytes_matches_node_vector() {
    let token = token_from_bytes(&[7u8; 32]);
    assert_eq!(
        token.plaintext,
        "tt_BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc"
    );
    assert_eq!(
        token.hash_bytea,
        "\\xf3a91e2f72cefaec67bb4df7a9b80e0b67841ee941fda2e02f4aa6e15bca62ba"
    );
    assert_eq!(token.prefix, "tt_BwcHBwcH…");
}

#[test]
fn generate_token_is_random_and_prefixed() {
    let first = generate_token().unwrap();
    let second = generate_token().unwrap();
    assert!(first.plaintext.starts_with("tt_"));
    assert_eq!(first.plaintext.len(), 46);
    assert_ne!(first.plaintext, second.plaintext);
}

#[test]
fn is_expiry_days_accepts_absent_null_and_whole_days() {
    assert!(is_expiry_days(None));
    assert!(is_expiry_days(Some(&Value::Null)));
    for value in [json!(0), json!(30), json!(36500), json!(5.0)] {
        assert!(is_expiry_days(Some(&value)), "{value} should be accepted");
    }
}

#[test]
fn is_expiry_days_rejects_everything_else() {
    for value in [
        json!(-1),
        json!(36501),
        json!(1.5),
        json!("30"),
        json!(true),
        json!([]),
    ] {
        assert!(!is_expiry_days(Some(&value)), "{value} should be rejected");
    }
}

#[test]
fn expiry_from_days_is_none_without_positive_days() {
    assert_eq!(expiry_from_days(None, 0), None);
    assert_eq!(expiry_from_days(Some(&Value::Null), 0), None);
    assert_eq!(expiry_from_days(Some(&json!(0)), 0), None);
    assert_eq!(expiry_from_days(Some(&json!(-3)), 0), None);
}

#[test]
fn expiry_from_days_adds_whole_days() {
    assert_eq!(
        expiry_from_days(Some(&json!(1)), 0).as_deref(),
        Some("1970-01-02T00:00:00.000Z")
    );
}

#[test]
fn map_row_copies_every_column() {
    let row = json!({
        "id": "t1",
        "name": "laptop",
        "token_prefix": "tt_BwcHBwcH…",
        "expires_at": null,
        "last_used_at": "2026-01-02T03:04:05.000Z",
        "created_at": "2026-01-01T00:00:00.000Z",
        "scopes": ["sdk"]
    });
    assert_eq!(
        map_row(&row),
        json!({
            "id": "t1",
            "name": "laptop",
            "tokenPrefix": "tt_BwcHBwcH…",
            "expiresAt": null,
            "lastUsedAt": "2026-01-02T03:04:05.000Z",
            "createdAt": "2026-01-01T00:00:00.000Z",
            "scopes": ["sdk"]
        })
    );
}

#[test]
fn map_row_defaults_scopes_to_empty_list() {
    let row = json!({ "id": "t1", "scopes": null });
    assert_eq!(map_row(&row)["scopes"], json!([]));
}

#[test]
fn map_row_turns_missing_fields_into_null() {
    assert_eq!(
        map_row(&json!({})),
        json!({
            "id": null,
            "name": null,
            "tokenPrefix": null,
            "expiresAt": null,
            "lastUsedAt": null,
            "createdAt": null,
            "scopes": []
        })
    );
}
