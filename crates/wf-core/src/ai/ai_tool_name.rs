//! Tool-name canonicalisation and the untrusted-context boundary nonce (JS `ai-types.ts`,
//! `untrusted-context.ts`). Randomness stays in JS: the caller passes the random numbers in.

const PROPOSE_PREFIX: &str = "propose_";
const SUGGEST_PREFIX: &str = "suggest_";
const NONCE_LENGTH: usize = 16;
const NONCE_ALPHABET: &[u8] = b"abcdefghijklmnopqrstuvwxyz0123456789";

/// Map a pre-rename `propose_*` tool name to `suggest_*`; any other name is returned unchanged.
#[must_use]
pub fn canonical_ai_tool_name(name: &str) -> String {
    match name.strip_prefix(PROPOSE_PREFIX) {
        Some(rest) => format!("{SUGGEST_PREFIX}{rest}"),
        None => name.to_string(),
    }
}

/// Build a 16-char nonce from successive `Math.random()` values; a missing or out-of-range
/// value yields `'0'`, as the JS `?? "0"` fallback does.
#[must_use]
pub fn context_nonce_from(randoms: &[f64]) -> String {
    (0..NONCE_LENGTH)
        .map(|index| {
            let random = randoms.get(index).copied().unwrap_or(f64::NAN);
            let slot = (random * NONCE_ALPHABET.len() as f64).floor();
            // Negative, NaN and >= 36 slots are undefined in JS; `as usize` would saturate them.
            #[allow(
                clippy::cast_possible_truncation,
                clippy::cast_sign_loss,
                reason = "slot is checked to be in 0..36 first"
            )]
            if slot >= 0.0 && slot < NONCE_ALPHABET.len() as f64 {
                char::from(NONCE_ALPHABET[slot as usize])
            } else {
                '0'
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn propose_prefix_maps_to_suggest() {
        assert_eq!(
            canonical_ai_tool_name("propose_paper_update"),
            "suggest_paper_update"
        );
        assert_eq!(canonical_ai_tool_name("propose_"), "suggest_");
    }

    #[test]
    fn other_names_are_unchanged() {
        assert_eq!(
            canonical_ai_tool_name("search_workspace"),
            "search_workspace"
        );
        assert_eq!(
            canonical_ai_tool_name("suggest_relation"),
            "suggest_relation"
        );
    }

    #[test]
    fn zero_randomness_gives_all_a() {
        assert_eq!(context_nonce_from(&[0.0; 16]), "aaaaaaaaaaaaaaaa");
    }

    #[test]
    fn last_alphabet_slot_is_nine() {
        assert_eq!(context_nonce_from(&[35.5 / 36.0; 16]), "9999999999999999");
    }

    #[test]
    fn out_of_range_randomness_falls_back_to_zero() {
        // 1.0 indexes past the alphabet; a short input is treated as NaN.
        assert_eq!(context_nonce_from(&[1.0; 16]), "0000000000000000");
        assert_eq!(context_nonce_from(&[-0.5; 16]), "0000000000000000");
        assert_eq!(context_nonce_from(&[0.0]), "a000000000000000");
    }
}
