//! Colour slot for a tag (wf-core `tag_tone`). Ported from `apps/web/src/lib/tag-tone.ts`.
//! A tag keeps its slot everywhere, so the hash must match the TypeScript one exactly.

/// Number of tag colour slots per theme (`--tag-N-*`).
const TAG_TONES: u32 = 6;

/// Slot in `1..=6` for `tag`. The tag is lowercased, then each code point's first UTF-16
/// unit is folded into `h = h * 31 + unit` (wrapping at 2^32), matching JS `charCodeAt(0)`.
/// Astral code points therefore contribute only their high surrogate.
#[must_use]
pub fn tag_tone(tag: &str) -> u32 {
    let mut h: u32 = 0;
    for ch in tag.to_lowercase().chars() {
        h = h.wrapping_mul(31).wrapping_add(first_code_unit(ch));
    }
    (h % TAG_TONES) + 1
}

/// The first UTF-16 code unit of `ch`: the code point itself, or the high surrogate above U+FFFF.
const fn first_code_unit(ch: char) -> u32 {
    let cp = ch as u32;
    if cp > 0xFFFF {
        0xD800 + ((cp - 0x1_0000) >> 10)
    } else {
        cp
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::search::js_text::is_js_whitespace;

    #[test]
    fn slots_stay_in_range() {
        for tag in ["", "a", "research", "Ünïcode", "🙂 tag"] {
            let t = tag_tone(tag);
            assert!((1..=6).contains(&t), "{tag:?} -> {t}");
        }
    }

    #[test]
    fn matches_js_hash_for_ascii() {
        // "a" = 97, 97 % 6 = 1, +1 = 2.
        assert_eq!(tag_tone("a"), 2);
        // "ab": (97*31 + 98) = 3105, 3105 % 6 = 3, +1 = 4.
        assert_eq!(tag_tone("ab"), 4);
    }

    #[test]
    fn case_is_folded_before_hashing() {
        assert_eq!(tag_tone("Research"), tag_tone("research"));
    }

    #[test]
    fn astral_uses_high_surrogate_only() {
        // U+1F642 high surrogate is 0xD83D; a single-unit tag hashes to 0xD83D % 6 + 1.
        let expected = (0xD83D_u32 % 6) + 1;
        assert_eq!(tag_tone("\u{1F642}"), expected);
    }

    #[test]
    fn empty_tag_is_slot_one() {
        assert_eq!(tag_tone(""), 1);
    }

    #[test]
    fn js_whitespace_helper_is_reachable() {
        assert!(is_js_whitespace(' '));
    }
}
