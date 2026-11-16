//! bytea hex (`\x…`, PostgREST) and base64 codecs (the former `apps/web/src/lib/bytea.ts`).
//! Output must stay byte-for-byte the same as the TypeScript it replaces: stored payloads depend on it.

const HEX: &[u8; 16] = b"0123456789abcdef";
const BASE64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/// Bytes from a PostgREST bytea string: the `\x` prefix is optional, and each pair of hex digits is one byte.
///
/// A pair that is not hex reads as `0`, and an odd trailing digit is dropped, as the old
/// `parseInt` into a `Uint8Array` did.
#[must_use]
pub fn decode_bytea(text: &str) -> Vec<u8> {
    let hex = text.strip_prefix("\\x").unwrap_or(text);
    hex.as_bytes()
        .as_chunks::<2>()
        .0
        .iter()
        .map(|&[high, low]| hex_pair(high, low))
        .collect()
}

/// PostgREST bytea string: `\x` followed by two lowercase hex digits per byte.
#[must_use]
pub fn encode_bytea(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(2 + bytes.len() * 2);
    out.push_str("\\x");
    for &byte in bytes {
        out.push(char::from(HEX[usize::from(byte >> 4)]));
        out.push(char::from(HEX[usize::from(byte & 0x0f)]));
    }
    out
}

/// Bytes from base64, with the same leniency as `atob`: ASCII whitespace is skipped, padding is optional.
///
/// # Errors
/// Returns a message when a character is outside the base64 alphabet or the length cannot be base64.
pub fn decode_base64(input: &str) -> Result<Vec<u8>, &'static str> {
    let mut data: Vec<u8> = input.bytes().filter(|b| !b.is_ascii_whitespace()).collect();
    if data.len().is_multiple_of(4) {
        for _ in 0..2 {
            if data.last() == Some(&b'=') {
                let _ = data.pop();
            }
        }
    }
    if data.len() % 4 == 1 {
        return Err("invalid base64 length");
    }
    let mut out = Vec::with_capacity(data.len() / 4 * 3 + 2);
    for chunk in data.chunks(4) {
        let mut bits: u32 = 0;
        for (i, &byte) in chunk.iter().enumerate() {
            let value = base64_value(byte).ok_or("invalid base64 character")?;
            bits |= value << (18 - 6 * i);
        }
        let [_, first, second, third] = bits.to_be_bytes();
        let triple = [first, second, third];
        out.extend_from_slice(&triple[..chunk.len().saturating_sub(1)]);
    }
    Ok(out)
}

/// Standard base64 with `=` padding.
#[must_use]
pub fn encode_base64(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let bits = chunk.iter().enumerate().fold(0u32, |acc, (i, &byte)| {
            acc | (u32::from(byte) << (16 - 8 * i))
        });
        for i in 0..4 {
            if i <= chunk.len() {
                let index = (bits >> (18 - 6 * i)) & 0x3f;
                out.push(char::from(BASE64[index as usize]));
            } else {
                out.push('=');
            }
        }
    }
    out
}

fn hex_pair(high: u8, low: u8) -> u8 {
    match (hex_digit(high), hex_digit(low)) {
        (Some(high), Some(low)) => high * 16 + low,
        _ => 0,
    }
}

fn hex_digit(byte: u8) -> Option<u8> {
    char::from(byte)
        .to_digit(16)
        .and_then(|digit| u8::try_from(digit).ok())
}

fn base64_value(byte: u8) -> Option<u32> {
    match byte {
        b'A'..=b'Z' => Some(u32::from(byte - b'A')),
        b'a'..=b'z' => Some(u32::from(byte - b'a') + 26),
        b'0'..=b'9' => Some(u32::from(byte - b'0') + 52),
        b'+' => Some(62),
        b'/' => Some(63),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_hex_with_and_without_prefix() {
        assert_eq!(decode_bytea("\\x0aff"), vec![10, 255]);
        assert_eq!(decode_bytea("0aff"), vec![10, 255]);
    }

    #[test]
    fn odd_hex_digit_is_dropped() {
        assert_eq!(decode_bytea("\\x0a1"), vec![10]);
    }

    #[test]
    fn encodes_lowercase_prefixed_hex() {
        assert_eq!(encode_bytea(&[10, 255, 0]), "\\x0aff00");
        assert_eq!(encode_bytea(&[]), "\\x");
    }

    #[test]
    fn bytea_round_trips() {
        let bytes: Vec<u8> = (0..=255).collect();
        assert_eq!(decode_bytea(&encode_bytea(&bytes)), bytes);
    }

    #[test]
    fn base64_known_vectors() {
        assert_eq!(encode_base64(b"Man"), "TWFu");
        assert_eq!(encode_base64(b"Ma"), "TWE=");
        assert_eq!(encode_base64(b"M"), "TQ==");
        assert_eq!(encode_base64(b""), "");
    }

    #[test]
    fn base64_decodes_with_or_without_padding_and_whitespace() {
        assert_eq!(decode_base64("TWFu"), Ok(b"Man".to_vec()));
        assert_eq!(decode_base64("TWE="), Ok(b"Ma".to_vec()));
        assert_eq!(decode_base64("TQ"), Ok(b"M".to_vec()));
        assert_eq!(decode_base64("TW Fu\n"), Ok(b"Man".to_vec()));
    }

    #[test]
    fn base64_rejects_bad_input() {
        assert_eq!(decode_base64("T!=="), Err("invalid base64 character"));
        assert_eq!(decode_base64("TWFuT"), Err("invalid base64 length"));
    }

    #[test]
    fn base64_round_trips_large_payload() {
        let bytes: Vec<u8> = (0..=250u8).cycle().take(200_000).collect();
        assert_eq!(decode_base64(&encode_base64(&bytes)), Ok(bytes));
    }
}
