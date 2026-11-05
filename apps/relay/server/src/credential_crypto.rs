//! Seals and opens stored integration credentials with AES-256-GCM, in the same
//! envelope as the web app: `{"iv": b64url, "ciphertext": b64url(ciphertext || tag)}`.

use aes_gcm::aead::Aead;
use aes_gcm::{Aes256Gcm, KeyInit, Nonce};
use base64::Engine;
use base64::alphabet;
use base64::engine::DecodePaddingMode;
use base64::engine::general_purpose::{GeneralPurpose, GeneralPurposeConfig, URL_SAFE_NO_PAD};
use serde_json::Value;
use sha2::{Digest, Sha256};

/// Returned when no credential key is configured.
pub const MISSING_KEY: &str = "OVERLEAF_CREDENTIAL_KEY is not configured on the server.";
/// Returned when the stored envelope is not JSON.
pub const NOT_JSON: &str = "Stored credential envelope is invalid (not JSON).";
/// Returned when the ciphertext is too short to hold a GCM tag.
pub const TOO_SHORT: &str = "Stored credential envelope is invalid (ciphertext too short).";
/// Returned when decryption fails (wrong key, altered data, or a bad IV).
pub const AUTH_FAILED: &str =
    "Stored credential could not be decrypted (auth tag mismatch: wrong key or altered data).";

/// Accepts padded or unpadded base64url, as Node's `base64url` decoder does.
const LENIENT: GeneralPurpose = GeneralPurpose::new(
    &alphabet::URL_SAFE,
    GeneralPurposeConfig::new()
        .with_decode_padding_mode(DecodePaddingMode::Indifferent)
        .with_decode_allow_trailing_bits(true),
);

/// Seals `plain` under `secret` with a random IV.
pub fn seal(plain: &str, secret: Option<&str>) -> Result<String, String> {
    if secret.is_none() {
        return Err(MISSING_KEY.to_string());
    }
    let mut iv = [0u8; 12];
    getrandom::fill(&mut iv).map_err(|_| "Could not generate a secure IV.".to_string())?;
    seal_with_iv(plain, secret, &iv)
}

/// Seals `plain` under `secret` with the given IV.
pub fn seal_with_iv(plain: &str, secret: Option<&str>, iv: &[u8; 12]) -> Result<String, String> {
    let cipher = cipher_for(secret)?;
    let sealed = cipher
        .encrypt(Nonce::from_slice(iv), plain.as_bytes())
        .map_err(|_| "Could not seal the credential.".to_string())?;
    Ok(format!(
        r#"{{"iv":"{}","ciphertext":"{}"}}"#,
        URL_SAFE_NO_PAD.encode(iv),
        URL_SAFE_NO_PAD.encode(sealed)
    ))
}

/// Opens an envelope sealed by [`seal`] or the web app and returns the plain text.
pub fn open(envelope: &str, secret: Option<&str>) -> Result<String, String> {
    let parsed: Value = serde_json::from_str(envelope).map_err(|_| NOT_JSON.to_string())?;
    let raw = decoded_field(&parsed, "ciphertext");
    if raw.len() <= 16 {
        return Err(TOO_SHORT.to_string());
    }
    let cipher = cipher_for(secret)?;
    let iv: [u8; 12] = decoded_field(&parsed, "iv")
        .try_into()
        .map_err(|_| AUTH_FAILED.to_string())?;
    let plain = cipher
        .decrypt(Nonce::from_slice(&iv), raw.as_slice())
        .map_err(|_| AUTH_FAILED.to_string())?;
    Ok(String::from_utf8_lossy(&plain).into_owned())
}

/// The AES-256 key: SHA-256 of the untrimmed secret.
fn cipher_for(secret: Option<&str>) -> Result<Aes256Gcm, String> {
    let secret = secret.ok_or_else(|| MISSING_KEY.to_string())?;
    let digest = Sha256::digest(secret.as_bytes());
    Aes256Gcm::new_from_slice(digest.as_slice()).map_err(|_| AUTH_FAILED.to_string())
}

/// A string field decoded from base64url; empty when missing or undecodable.
fn decoded_field(parsed: &Value, name: &str) -> Vec<u8> {
    parsed
        .get(name)
        .and_then(Value::as_str)
        .and_then(|text| LENIENT.decode(text).ok())
        .unwrap_or_default()
}
