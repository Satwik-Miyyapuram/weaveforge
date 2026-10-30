//! JavaScript text rules: whitespace, `\p{L}|\p{N}` and UTF-16 length.

use unicode_properties::{GeneralCategoryGroup, UnicodeGeneralCategory};

/// True for the ECMAScript `WhiteSpace` and `LineTerminator` code points.
#[must_use]
pub const fn is_js_whitespace(ch: char) -> bool {
    matches!(
        ch,
        '\u{9}'..='\u{d}'
            | '\u{20}'
            | '\u{a0}'
            | '\u{1680}'
            | '\u{2000}'..='\u{200a}'
            | '\u{2028}'
            | '\u{2029}'
            | '\u{202f}'
            | '\u{205f}'
            | '\u{3000}'
            | '\u{feff}'
    )
}

/// True for JS `\p{L}` or `\p{N}`. Not `char::is_alphabetic`, which also accepts marks.
/// ASCII takes a fast path: only `[0-9A-Za-z]` are letters or numbers there.
#[must_use]
pub fn is_letter_or_number(ch: char) -> bool {
    if ch.is_ascii() {
        return ch.is_ascii_alphanumeric();
    }
    matches!(
        ch.general_category_group(),
        GeneralCategoryGroup::Letter | GeneralCategoryGroup::Number
    )
}

/// Length in UTF-16 code units, as JS `String.length` counts.
#[must_use]
pub fn utf16_len(s: &str) -> usize {
    s.chars().map(char::len_utf16).sum()
}
