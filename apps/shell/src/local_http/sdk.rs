//! What the Python SDK's `/api/sdk/*` routes share. The routes themselves are in
//! `sdk_files.rs`; 0.9.8 removed the local-database answers, so nothing here runs SQL.

/// The path prefix every SDK route shares.
pub const SDK_PREFIX: &str = "/api/sdk/";

/// `LOCAL_USER_ID` from `packages/core/src/local-user.ts`.
pub const LOCAL_USER_ID: &str = "00000000-0000-4000-8000-000000000001";

/// `searchParams.get(key)?.trim()`: the first value for `key`, or `""` when absent.
pub(super) fn trimmed_param(search: &str, key: &str) -> String {
    search
        .split('&')
        .filter(|pair| !pair.is_empty())
        .map(|pair| pair.split_once('=').unwrap_or((pair, "")))
        .find(|(name, _)| form_decode(name) == key)
        .map(|(_, value)| form_decode(value).trim().to_owned())
        .unwrap_or_default()
}

/// Form decoding as `URLSearchParams` does it: `+` is a space, then `%XX`; bad escapes stay as written.
fn form_decode(raw: &str) -> String {
    let bytes: Vec<u8> = raw
        .bytes()
        .map(|b| if b == b'+' { b' ' } else { b })
        .collect();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        let escape = match bytes.get(i..i + 3) {
            Some([b'%', hi, lo]) => hex_value(*hi)
                .zip(hex_value(*lo))
                .map(|(h, l)| (h << 4) | l),
            _ => None,
        };
        match escape {
            Some(byte) => {
                out.push(byte);
                i += 3;
            }
            None => {
                out.push(bytes[i]);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// The value of one ASCII hex digit.
#[allow(
    clippy::cast_possible_truncation,
    reason = "to_digit(16) yields at most 15"
)]
fn hex_value(byte: u8) -> Option<u8> {
    char::from(byte).to_digit(16).map(|d| d as u8)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_param_decodes_like_url_search_params_and_is_trimmed() {
        assert_eq!(
            trimmed_param("name=%20%20Offline+Trial%21%20", "name"),
            "Offline Trial!"
        );
        assert_eq!(
            trimmed_param("name=Offline%20Trial", "name"),
            "Offline Trial"
        );
    }

    #[test]
    fn the_first_value_wins_and_a_missing_key_is_empty() {
        assert_eq!(trimmed_param("name=a&name=b", "name"), "a");
        assert_eq!(trimmed_param("other=a", "name"), "");
        assert_eq!(trimmed_param("", "name"), "");
        assert_eq!(trimmed_param("name", "name"), "");
    }

    #[test]
    fn a_bad_escape_stays_as_written() {
        assert_eq!(trimmed_param("name=100%zz", "name"), "100%zz");
        assert_eq!(trimmed_param("name=50%", "name"), "50%");
    }

    #[test]
    fn keys_are_decoded_too() {
        assert_eq!(trimmed_param("na%6De=Lab", "name"), "Lab");
    }
}
