#![allow(clippy::unwrap_used, clippy::expect_used, missing_docs)]

use wf_relay_server::credential_crypto::{
    AUTH_FAILED, MISSING_KEY, NOT_JSON, TOO_SHORT, open, seal, seal_with_iv,
};

const KEY: &str = "test-key";
const IV: [u8; 12] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const PLAIN: &str = r#"{"zoteroApiKey":"abc"}"#;
/// Sealed by the Node reference (`createCipheriv`) with the key, IV and plain above.
const NODE_ENVELOPE: &str = r#"{"iv":"AAECAwQFBgcICQoL","ciphertext":"yUpOCgagenyCpkh6Ah1WV5HDhGVN85on62pTzenZGcj6uBNe4OA"}"#;
const NODE_CIPHERTEXT: &str = "yUpOCgagenyCpkh6Ah1WV5HDhGVN85on62pTzenZGcj6uBNe4OA";

#[test]
fn seal_with_iv_matches_the_node_vector() {
    let sealed = seal_with_iv(PLAIN, Some(KEY), &IV).unwrap();
    assert_eq!(sealed, NODE_ENVELOPE);
}

#[test]
fn open_reads_the_node_vector() {
    assert_eq!(open(NODE_ENVELOPE, Some(KEY)).unwrap(), PLAIN);
}

#[test]
fn seal_and_open_round_trip_with_a_random_iv() {
    let first = seal(PLAIN, Some(KEY)).unwrap();
    let second = seal(PLAIN, Some(KEY)).unwrap();
    assert_ne!(first, second);
    assert_eq!(open(&first, Some(KEY)).unwrap(), PLAIN);
    assert_eq!(open(&second, Some(KEY)).unwrap(), PLAIN);
}

#[test]
fn seal_refuses_without_a_key() {
    assert_eq!(seal(PLAIN, None), Err(MISSING_KEY.to_string()));
    assert_eq!(seal_with_iv(PLAIN, None, &IV), Err(MISSING_KEY.to_string()));
}

#[test]
fn open_refuses_a_value_that_is_not_json() {
    assert_eq!(open("nope", Some(KEY)), Err(NOT_JSON.to_string()));
}

#[test]
fn open_refuses_a_short_or_missing_ciphertext() {
    let short = r#"{"iv":"AAECAwQFBgcICQoL","ciphertext":"AAAA"}"#;
    assert_eq!(open(short, Some(KEY)), Err(TOO_SHORT.to_string()));
    assert_eq!(open("{}", Some(KEY)), Err(TOO_SHORT.to_string()));
}

#[test]
fn open_needs_a_key() {
    assert_eq!(open(NODE_ENVELOPE, None), Err(MISSING_KEY.to_string()));
}

#[test]
fn open_refuses_the_wrong_key() {
    assert_eq!(
        open(NODE_ENVELOPE, Some("other")),
        Err(AUTH_FAILED.to_string())
    );
}

#[test]
fn open_refuses_altered_ciphertext() {
    let tampered = NODE_ENVELOPE.replacen("\"yUp", "\"zUp", 1);
    assert_ne!(tampered, NODE_ENVELOPE);
    assert_eq!(open(&tampered, Some(KEY)), Err(AUTH_FAILED.to_string()));
}

#[test]
fn open_refuses_an_iv_that_is_not_twelve_bytes() {
    // 8-byte IV (0..7) in place of the 12-byte one.
    let short_iv = format!(r#"{{"iv":"AAECAwQFBgc","ciphertext":"{NODE_CIPHERTEXT}"}}"#);
    assert_eq!(open(&short_iv, Some(KEY)), Err(AUTH_FAILED.to_string()));
}

#[test]
fn open_accepts_padded_base64() {
    // 51 unpadded chars; one "=" makes it a valid padded base64url string.
    let padded = format!(r#"{{"iv":"AAECAwQFBgcICQoL","ciphertext":"{NODE_CIPHERTEXT}="}}"#);
    assert_eq!(open(&padded, Some(KEY)).unwrap(), PLAIN);
}
