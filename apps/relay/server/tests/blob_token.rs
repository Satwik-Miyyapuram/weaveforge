#![allow(clippy::unwrap_used, clippy::expect_used, missing_docs)]

//! Tests for the signed blob view tokens in `wf_relay_server::blob_token`.

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use hmac::{Hmac, Mac};
use sha2::Sha256;

use wf_relay_server::blob_token::{BlobViewPayload, content_url, mint, verify};

fn payload(exp: u64) -> BlobViewPayload {
    BlobViewPayload {
        uid: "u1".into(),
        bucket: "paper-images".into(),
        path: "u1/a.png".into(),
        tier: "hot".into(),
        exp,
    }
}

/// HMAC-SHA256 of `body`, base64url without padding, as the token format needs.
fn sign(body: &str, secret: &str) -> String {
    let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes()).unwrap();
    mac.update(body.as_bytes());
    URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes())
}

#[test]
fn mint_then_verify_round_trips() {
    let token = mint(&payload(4800), "s");
    assert_eq!(verify(&token, "s", 1000), Some(payload(4800)));
}

#[test]
fn body_is_base64url_of_the_json_in_field_order() {
    let token = mint(&payload(4800), "s");
    let (body, _sig) = token.split_once('.').unwrap();
    let json = r#"{"uid":"u1","bucket":"paper-images","path":"u1/a.png","tier":"hot","exp":4800}"#;
    assert_eq!(body, URL_SAFE_NO_PAD.encode(json));
}

#[test]
fn tampered_body_is_rejected() {
    let token = mint(&payload(4800), "s");
    let (_body, sig) = token.split_once('.').unwrap();
    let other = r#"{"uid":"u2","bucket":"paper-images","path":"u1/a.png","tier":"hot","exp":4800}"#;
    let forged = format!("{}.{sig}", URL_SAFE_NO_PAD.encode(other));
    assert_eq!(verify(&forged, "s", 1000), None);
}

#[test]
fn wrong_secret_is_rejected() {
    let token = mint(&payload(4800), "s");
    assert_eq!(verify(&token, "other", 1000), None);
}

#[test]
fn malformed_tokens_are_rejected() {
    assert_eq!(verify("abc", "s", 1000), None);
    assert_eq!(verify(".x", "s", 1000), None);
    assert_eq!(verify("x.", "s", 1000), None);
}

#[test]
fn expired_token_is_rejected() {
    let token = mint(&payload(4800), "s");
    assert_eq!(verify(&token, "s", 4801), None);
}

#[test]
fn token_is_valid_at_its_exact_expiry() {
    let token = mint(&payload(4800), "s");
    assert_eq!(verify(&token, "s", 4800), Some(payload(4800)));
}

#[test]
fn empty_tier_is_rejected() {
    let mut empty = payload(4800);
    empty.tier = String::new();
    let token = mint(&empty, "s");
    assert_eq!(verify(&token, "s", 1000), None);
}

#[test]
fn missing_exp_is_rejected_even_when_signed() {
    let body = URL_SAFE_NO_PAD
        .encode(r#"{"uid":"u1","bucket":"paper-images","path":"u1/a.png","tier":"hot"}"#);
    let token = format!("{body}.{}", sign(&body, "s"));
    assert_eq!(verify(&token, "s", 1000), None);
}

#[test]
fn content_url_carries_the_rounded_expiry() {
    let url = content_url(
        "https://api.x",
        "u1",
        "paper-images",
        "u1/a.png",
        "hot",
        3600,
        "s",
        1000,
    );
    assert!(url.starts_with("https://api.x/api/blobs/content?t="));
    let token = url
        .strip_prefix("https://api.x/api/blobs/content?t=")
        .unwrap();
    assert_eq!(verify(token, "s", 1000), Some(payload(4800)));
}
