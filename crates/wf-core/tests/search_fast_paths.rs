//! Pins the ASCII fast paths and the repeated-word skip of P1.7c to the slow
//! general paths. Each fast path must give the same output as the general
//! path it skips.

use proptest::prelude::*;
use unicode_properties::{GeneralCategoryGroup, UnicodeGeneralCategory};
use wf_core::search::js_text::is_letter_or_number;
use wf_core::search::tokenizer::{TokenizerOptions, fold_diacritics, process_term, tokenize};

/// Builds options from the low four bits of `mask`, one bit per flag.
const fn options_for(mask: u8) -> TokenizerOptions {
    TokenizerOptions {
        fold_diacritics: mask & 1 != 0,
        fold_arabic_diacritics: mask & 2 != 0,
        split_camel_case: mask & 4 != 0,
        tokenize_urls: mask & 8 != 0,
    }
}

#[test]
fn letter_or_number_matches_the_general_category_for_every_char() {
    for code in 0u32..=0x10FFFF {
        let Some(ch) = char::from_u32(code) else {
            continue;
        };
        assert_eq!(
            is_letter_or_number(ch),
            matches!(
                ch.general_category_group(),
                GeneralCategoryGroup::Letter | GeneralCategoryGroup::Number
            ),
            "mismatch at code point {code:#x}"
        );
    }
}

proptest! {
    #[test]
    fn ascii_fold_is_identity_and_process_is_lowercase(
        s in "[ -~]{0,40}",
        fold in any::<bool>(),
        arabic in any::<bool>(),
        camel in any::<bool>(),
        urls in any::<bool>(),
    ) {
        let options = TokenizerOptions {
            fold_diacritics: fold,
            fold_arabic_diacritics: arabic,
            split_camel_case: camel,
            tokenize_urls: urls,
        };
        prop_assert_eq!(fold_diacritics(&s, arabic), s.clone());
        prop_assert_eq!(process_term(&s, &options), s.to_lowercase());
    }

    #[test]
    fn repeating_the_text_adds_no_tokens(text in r"\PC{0,48}", mask in 0u8..16) {
        let options = options_for(mask);
        let twice = format!("{text} {text}");
        prop_assert_eq!(tokenize(&twice, &options), tokenize(&text, &options));
    }
}
