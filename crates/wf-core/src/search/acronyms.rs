//! Initialisms derived from a title, so "GAN" finds "Generative Adversarial Networks". Port of
//! `packages/core/src/search/search-acronyms.ts`. Pure.

use unicode_properties::{GeneralCategory, GeneralCategoryGroup, UnicodeGeneralCategory};

use crate::search::js_text::{is_js_whitespace, is_letter_or_number, utf16_len};

/// Words that are part of a title's grammar rather than its subject (TS `SKIP_WORDS`).
const SKIP_WORDS: &[&str] = &[
    "a", "an", "the", "of", "for", "and", "or", "with", "without", "in", "on", "at", "to", "from",
    "by", "as", "is", "are", "be", "via", "using", "toward", "towards", "into", "over", "under",
    "between", "across", "you", "your", "its", "it", "we", "our",
];

/// Below this an "acronym" is too short to be a useful or unambiguous handle.
const MIN_ACRONYM_LENGTH: usize = 3;
/// Fewer significant words than this cannot form a handle worth indexing.
const MIN_ACRONYM_WORDS: usize = 3;
/// Above this nobody is typing it as a shorthand.
const MAX_ACRONYM_LENGTH: usize = 8;
/// Long titles also index the initials of this many leading words.
const LEADING_WORDS: usize = 4;
/// Length bounds of the `:` head, in UTF-16 units (TS `(.{2,60}?)`).
const HEAD_MIN_UTF16: usize = 2;
const HEAD_MAX_UTF16: usize = 60;

/// Acronyms worth indexing for a title (TS `acronymsForTitle`). Usually one; empty for titles
/// that are already short or that would produce something meaningless.
#[must_use]
pub fn acronyms_for_title(title: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();

    // A capitalised initialism inside the title ("β-VAE", "BERT") is findable by itself,
    // whatever the word-count rule below says.
    for token in title.split(|ch: char| !is_letter_or_number(ch)) {
        let len = utf16_len(token);
        if (MIN_ACRONYM_LENGTH..=MAX_ACRONYM_LENGTH).contains(&len)
            && token.chars().all(is_capital_or_number)
        {
            push_unique(&mut out, token.to_lowercase());
        }
    }

    let words = significant_words(title);
    if words.len() >= MIN_ACRONYM_WORDS {
        let all = initials(&words);
        if (MIN_ACRONYM_LENGTH..=MAX_ACRONYM_LENGTH).contains(&utf16_len(&all)) {
            push_unique(&mut out, all);
        }
        // The first few words are the part people remember: "drli" for DRLIR.
        if words.len() > LEADING_WORDS {
            let leading = initials(&words[..LEADING_WORDS]);
            if utf16_len(&leading) >= MIN_ACRONYM_LENGTH {
                push_unique(&mut out, leading);
            }
        }
    }
    out
}

/// Lowercased first letters of `words`, as the TS joins `word[0]` then lowercases.
fn initials(words: &[&str]) -> String {
    words
        .iter()
        .filter_map(|word| word.chars().next())
        .collect::<String>()
        .to_lowercase()
}

/// True for `\p{Lu}` and `\p{N}`, the characters a capitalised initialism may use.
fn is_capital_or_number(ch: char) -> bool {
    ch.general_category() == GeneralCategory::UppercaseLetter
        || ch.general_category_group() == GeneralCategoryGroup::Number
}

/// Split a title into the words an initialism is built from (TS `significantWords`).
fn significant_words(title: &str) -> Vec<&str> {
    title_head(title)
        .split(|ch: char| !is_letter_or_number(ch))
        .filter(|word| !word.is_empty() && !SKIP_WORDS.contains(&word.to_lowercase().as_str()))
        .collect()
}

/// The text before the first `:`, `—` or `–` when one is followed by a word, else the title.
/// Paper titles are "SHORTNAME: the long descriptive part".
fn title_head(title: &str) -> &str {
    let mut units = 0;
    for (start, ch) in title.char_indices() {
        // JS `.` never matches a line terminator.
        if matches!(ch, '\n' | '\r' | '\u{2028}' | '\u{2029}') {
            break;
        }
        units += ch.len_utf16();
        if units > HEAD_MAX_UTF16 {
            break;
        }
        let end = start + ch.len_utf8();
        if units >= HEAD_MIN_UTF16 && separator_follows(&title[end..]) {
            return &title[..end];
        }
    }
    title
}

/// Matches `\s*[:—–]\s+\S` at the start of `rest`.
fn separator_follows(rest: &str) -> bool {
    let rest = rest.trim_start_matches(is_js_whitespace);
    let Some(after_sep) = rest.strip_prefix([':', '\u{2014}', '\u{2013}']) else {
        return false;
    };
    let after_ws = after_sep.trim_start_matches(is_js_whitespace);
    after_ws.len() < after_sep.len()
        && after_ws
            .chars()
            .next()
            .is_some_and(|ch| !is_js_whitespace(ch))
}

/// Adds `value` unless already present, keeping first-seen order (TS `Set`).
fn push_unique(out: &mut Vec<String>, value: String) {
    if !out.contains(&value) {
        out.push(value);
    }
}

#[cfg(test)]
mod tests {
    use super::acronyms_for_title;

    #[test]
    fn three_words_give_initials() {
        assert_eq!(
            acronyms_for_title("Generative Adversarial Networks"),
            vec!["gan"]
        );
        assert_eq!(
            acronyms_for_title("Denoising Diffusion Probabilistic Models"),
            vec!["ddpm"]
        );
    }

    #[test]
    fn stop_words_are_skipped() {
        assert_eq!(
            acronyms_for_title("Learning to Rank with Graphs"),
            vec!["lrg"]
        );
    }

    #[test]
    fn long_titles_also_index_leading_words() {
        assert_eq!(
            acronyms_for_title("Deep Residual Learning for Image Recognition"),
            vec!["drlir", "drli"]
        );
    }

    #[test]
    fn colon_head_is_the_short_name() {
        assert_eq!(
            acronyms_for_title("BERT: Pre-training of Deep Bidirectional Transformers"),
            vec!["bert"]
        );
    }

    #[test]
    fn capitalised_tokens_come_first() {
        assert_eq!(
            acronyms_for_title("Fast R-CNN Object Detection"),
            vec!["cnn", "frcod", "frco"]
        );
    }

    #[test]
    fn short_or_empty_titles_give_nothing() {
        assert!(acronyms_for_title("").is_empty());
        assert!(acronyms_for_title("Neural Networks").is_empty());
    }
}
