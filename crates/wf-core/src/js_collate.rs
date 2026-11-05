//! JS `String.prototype.localeCompare` with no locale, approximated for the
//! strings WeaveForge sorts: paths, outline numbers and titles.

use std::cmp::Ordering;

use unicode_normalization::UnicodeNormalization;
use unicode_properties::{GeneralCategory, UnicodeGeneralCategory};

use crate::reader_analysis::lines::is_js_space;

/// ASCII in ICU root collation order: whitespace (with the next-line, line and
/// paragraph separators after CR) and punctuation, then symbols, digits, letters.
const COLLATION: &str = "\t\n\u{0B}\u{0C}\r\u{85}\u{2028}\u{2029} _-,;:!?.'\"()[]{}@*/\\&#%`^+<=>|~$0123456789abcdefghijklmnopqrstuvwxyz";

/// Latin-1 accented letters (lower case) and the base letter ICU sorts each with.
const ACCENTED: [(&str, char); 8] = [
    ("\u{e0}\u{e1}\u{e2}\u{e3}\u{e4}\u{e5}", 'a'),
    ("\u{e7}", 'c'),
    ("\u{e8}\u{e9}\u{ea}\u{eb}", 'e'),
    ("\u{ec}\u{ed}\u{ee}\u{ef}", 'i'),
    ("\u{f1}", 'n'),
    ("\u{f2}\u{f3}\u{f4}\u{f5}\u{f6}\u{f8}", 'o'),
    ("\u{f9}\u{fa}\u{fb}\u{fc}", 'u'),
    ("\u{fd}\u{ff}", 'y'),
];

/// A char lower-cased, and its base letter when it is a Latin-1 accented one.
fn fold(c: char) -> (char, Option<char>) {
    let lower = c.to_lowercase().next().unwrap_or(c);
    let base = ACCENTED
        .iter()
        .find(|(accented, _)| accented.contains(lower))
        .map(|&(_, base)| base);
    (lower, base)
}

/// True for chars ICU collation ignores: controls outside [`COLLATION`] and
/// zero-width format chars.
fn is_ignorable(c: char) -> bool {
    (c.is_control() && !COLLATION.contains(c))
        || matches!(
            c,
            '\u{ad}' | '\u{200b}'..='\u{200f}' | '\u{2060}' | '\u{feff}'
        )
}

/// The chars that take part in collation, with non-ASCII spaces outside
/// [`COLLATION`] read as a space.
fn collated(s: &str) -> impl Iterator<Item = char> + '_ {
    s.chars().filter(|&c| !is_ignorable(c)).map(|c| {
        if !c.is_ascii() && is_js_space(c) && !COLLATION.contains(c) {
            ' '
        } else {
            c
        }
    })
}

/// Primary weight of a char: its place in [`COLLATION`], case and accent folded;
/// any other char after every ASCII one, by code point.
fn primary_weight(c: char) -> u32 {
    let (lower, base) = fold(c);
    let key = base.unwrap_or(lower);
    COLLATION
        .find(key)
        .and_then(|at| u32::try_from(at).ok())
        .unwrap_or_else(|| 0x100 + u32::from(key))
}

/// Secondary weight: 0 for a plain char, else the accented letter's code point.
fn accent_weight(c: char) -> u32 {
    match fold(c) {
        (lower, Some(_)) => u32::from(lower),
        _ => 0,
    }
}

/// One collation element: primary weight, accent weight, 1 when upper case.
type Element = (u32, u32, u8);

/// Collation elements of a string. ASCII and Latin-1 letters map one to one; other chars
/// expand by NFKD (ICU sorts `\u{1c6}` as `dz` with a caron, `\u{fb01}` as `fi`), with
/// combining marks raising the accent weight of the letter before them.
fn elements(s: &str) -> Vec<Element> {
    let mut out: Vec<Element> = Vec::new();
    for c in collated(s) {
        if c.is_ascii() || fold(c).1.is_some() || c == '\u{f8}' || c == '\u{d8}' {
            out.push((
                primary_weight(c),
                accent_weight(c),
                u8::from(c.is_uppercase()),
            ));
            continue;
        }
        if c == '\u{df}' {
            out.extend([(primary_weight('s'), 0, 0), (primary_weight('s'), 0, 0)]);
            continue;
        }
        for d in c.nfkd() {
            let is_mark = d.general_category() == GeneralCategory::NonspacingMark;
            match out.last_mut() {
                Some(last) if is_mark => last.1 = last.1.max(u32::from(d)),
                _ => out.push((primary_weight(d), 0, u8::from(d.is_uppercase()))),
            }
        }
    }
    out
}

/// `a.localeCompare(b)` as an ordering: by collation weight with case and Latin-1
/// accents folded, then unaccented before accented, then lower case before upper
/// case. Controls and zero-width chars are ignored and Unicode spaces read as a
/// space, and other letters expand by NFKD. Exact for printable ASCII; chars with no
/// decomposition sort by code point.
#[must_use]
pub fn locale_compare(a: &str, b: &str) -> Ordering {
    let (a, b) = (elements(a), elements(b));
    let by = |key: fn(&Element) -> u32| a.iter().map(key).cmp(b.iter().map(key));
    by(|e| e.0)
        .then_with(|| by(|e| e.1))
        .then_with(|| by(|e| u32::from(e.2)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn case_blind_first_then_lower_before_upper() {
        assert_eq!(locale_compare("a", "B"), Ordering::Less);
        assert_eq!(locale_compare("a", "A"), Ordering::Less);
        assert_eq!(locale_compare("Ab", "aB"), Ordering::Greater);
        assert_eq!(locale_compare("x", "x"), Ordering::Equal);
    }

    #[test]
    fn punctuation_before_digits_before_letters() {
        assert_eq!(locale_compare("a_b", "a-b"), Ordering::Less);
        assert_eq!(locale_compare("a/b", "a.b"), Ordering::Greater);
        assert_eq!(locale_compare("9", "a"), Ordering::Less);
        assert_eq!(locale_compare("10", "9"), Ordering::Less);
        assert_eq!(locale_compare("", "a"), Ordering::Less);
    }

    #[test]
    fn latin_accents_sort_with_their_base_letter() {
        assert_eq!(locale_compare("\u{c9}t\u{e9}", "intro"), Ordering::Less);
        assert_eq!(locale_compare("ete", "\u{c9}t\u{e9}"), Ordering::Less);
        assert_eq!(
            locale_compare("\u{e9}t\u{e9}", "\u{c9}t\u{e9}"),
            Ordering::Less
        );
        assert_eq!(locale_compare("\u{e9}", "f"), Ordering::Less);
    }

    #[test]
    fn controls_ignored_and_unicode_spaces_sort_as_space() {
        assert_eq!(locale_compare("a\u{7}b", "ab"), Ordering::Equal);
        assert_eq!(locale_compare("\u{200b}b", "a"), Ordering::Greater);
        assert_eq!(locale_compare("\u{2003}z", "\u{1c6}a"), Ordering::Less);
        assert_eq!(locale_compare("\u{2028}<x", "\u{a0}\u{a0}"), Ordering::Less);
        assert_eq!(locale_compare("\r\n#", "\u{2028}\n"), Ordering::Less);
    }

    #[test]
    fn compatibility_letters_expand_as_icu_does() {
        assert_eq!(
            locale_compare("\u{1c6}a", "\u{f1}and\u{fa}"),
            Ordering::Less
        );
        assert_eq!(locale_compare("dza", "\u{1c6}a"), Ordering::Less);
        assert_eq!(locale_compare("\u{1c6}a", "dzb"), Ordering::Less);
        assert_eq!(locale_compare("\u{fb01}x", "fiy"), Ordering::Less);
        assert_eq!(locale_compare("stra\u{df}e", "strasz"), Ordering::Less);
        assert_eq!(locale_compare("\u{17e}", "z"), Ordering::Greater);
        assert_eq!(locale_compare("\u{17e}", "za"), Ordering::Less);
    }
}
