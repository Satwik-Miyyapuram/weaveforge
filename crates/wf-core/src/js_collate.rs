//! JS `String.prototype.localeCompare` with no locale, approximated for the
//! strings WeaveForge sorts: paths, outline numbers and titles.

use std::cmp::Ordering;

/// ASCII in ICU root collation order: whitespace and punctuation, then symbols,
/// digits, letters.
const COLLATION: &str =
    "\t\n\u{0B}\u{0C}\r _-,;:!?.'\"()[]{}@*/\\&#%`^+<=>|~$0123456789abcdefghijklmnopqrstuvwxyz";

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

/// `a.localeCompare(b)` as an ordering: by collation weight with case and Latin-1
/// accents folded, then unaccented before accented, then lower case before upper
/// case. Exact for ASCII; other non-ASCII is by code point.
#[must_use]
pub fn locale_compare(a: &str, b: &str) -> Ordering {
    a.chars()
        .map(primary_weight)
        .cmp(b.chars().map(primary_weight))
        .then_with(|| {
            a.chars()
                .map(accent_weight)
                .cmp(b.chars().map(accent_weight))
        })
        .then_with(|| {
            let case = |c: char| u8::from(c.is_uppercase());
            a.chars().map(case).cmp(b.chars().map(case))
        })
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
}
