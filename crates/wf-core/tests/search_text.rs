//! Golden tests for the phase-1 text rules. Expected values were produced by the
//! TypeScript in `packages/core/src/search/search-tokenizer.ts` on Node 24.

use wf_core::search::js_text::{is_js_whitespace, is_letter_or_number, utf16_len};
use wf_core::search::tokenizer::{TokenizerOptions, fold_diacritics, is_cjk, process_term};

const fn options(fold: bool, arabic: bool) -> TokenizerOptions {
    TokenizerOptions {
        fold_diacritics: fold,
        fold_arabic_diacritics: arabic,
        split_camel_case: true,
        tokenize_urls: true,
    }
}

/// (input, fold_diacritics(input, false), fold_diacritics(input, true))
const FOLD: &[(&str, &str, &str)] = &[
    ("caf\u{e9}", "cafe", "cafe"),
    ("M\u{dc}LLER", "MULLER", "MULLER"),
    ("\u{c5}ngstr\u{f6}m", "Angstrom", "Angstrom"),
    ("na\u{ef}ve", "naive", "naive"),
    ("\u{216b}", "\u{216b}", "\u{216b}"),
    ("\u{1c5}", "\u{1c5}", "\u{1c5}"),
    (
        "\u{3a3}\u{391}\u{3a3}",
        "\u{3a3}\u{391}\u{3a3}",
        "\u{3a3}\u{391}\u{3a3}",
    ),
    ("\u{130}stanbul", "Istanbul", "Istanbul"),
    ("\u{df}", "\u{df}", "\u{df}"),
    ("\u{fb01}", "\u{fb01}", "\u{fb01}"),
    ("e\u{301}", "e", "e"),
    ("\u{c5}", "A", "A"),
    ("\u{1e31}", "k", "k"),
    ("\u{152}uvre", "\u{152}uvre", "\u{152}uvre"),
    (
        "\u{ff37}\u{ff49}\u{ff44}\u{ff45}",
        "\u{ff37}\u{ff49}\u{ff44}\u{ff45}",
        "\u{ff37}\u{ff49}\u{ff44}\u{ff45}",
    ),
    (
        "\u{645}\u{64f}\u{62d}\u{64e}\u{645}\u{64e}\u{651}\u{62f}",
        "\u{645}\u{64f}\u{62d}\u{64e}\u{645}\u{64e}\u{651}\u{62f}",
        "\u{645}\u{62d}\u{645}\u{62f}",
    ),
    (
        "\u{645}\u{64f}\u{62d}\u{64e}\u{645}\u{64e}\u{651}\u{62f}\u{64c}",
        "\u{645}\u{64f}\u{62d}\u{64e}\u{645}\u{64e}\u{651}\u{62f}\u{64c}",
        "\u{645}\u{62d}\u{645}\u{62f}",
    ),
    (
        "\u{642}\u{64f}\u{631}\u{652}\u{622}\u{646}",
        "\u{642}\u{64f}\u{631}\u{652}\u{622}\u{646}",
        "\u{642}\u{631}\u{627}\u{646}",
    ),
    ("\u{670}\u{627}", "\u{670}\u{627}", "\u{627}"),
    ("\u{6d6}\u{627}", "\u{6d6}\u{627}", "\u{627}"),
    ("", "", ""),
    ("abc", "abc", "abc"),
    (
        "\u{65e5}\u{672c}\u{8a9e}",
        "\u{65e5}\u{672c}\u{8a9e}",
        "\u{65e5}\u{672c}\u{8a9e}",
    ),
    (
        "\u{d55c}\u{ad6d}\u{c5b4}",
        "\u{d55c}\u{ad6d}\u{c5b4}",
        "\u{d55c}\u{ad6d}\u{c5b4}",
    ),
    ("\u{20000}x", "\u{20000}x", "\u{20000}x"),
    (
        "\u{1d400}\u{1d401}",
        "\u{1d400}\u{1d401}",
        "\u{1d400}\u{1d401}",
    ),
    ("\u{1c4}", "\u{1c4}", "\u{1c4}"),
    (
        "\u{1f08}\u{3b8}\u{1fc6}\u{3bd}\u{3b1}\u{3b9}",
        "\u{391}\u{3b8}\u{3b7}\u{3bd}\u{3b1}\u{3b9}",
        "\u{391}\u{3b8}\u{3b7}\u{3bd}\u{3b1}\u{3b9}",
    ),
    ("\u{fb00}", "\u{fb00}", "\u{fb00}"),
    ("\u{fb50}", "\u{fb50}", "\u{fb50}"),
    ("\u{a0}x", "\u{a0}x", "\u{a0}x"),
    ("\u{24b6}", "\u{24b6}", "\u{24b6}"),
    ("\u{344}", "", ""),
    ("\u{958}", "\u{915}\u{93c}", "\u{915}\u{93c}"),
];

/// (input, {fold, no arabic}, {no fold, no arabic}, {fold, arabic})
const PROCESS_TERM: &[(&str, &str, &str, &str)] = &[
    ("caf\u{e9}", "cafe", "caf\u{e9}", "cafe"),
    ("M\u{dc}LLER", "muller", "m\u{fc}ller", "muller"),
    (
        "\u{c5}ngstr\u{f6}m",
        "angstrom",
        "\u{e5}ngstr\u{f6}m",
        "angstrom",
    ),
    ("na\u{ef}ve", "naive", "na\u{ef}ve", "naive"),
    ("\u{216b}", "\u{217b}", "\u{217b}", "\u{217b}"),
    ("\u{1c5}", "\u{1c6}", "\u{1c6}", "\u{1c6}"),
    (
        "\u{3a3}\u{391}\u{3a3}",
        "\u{3c3}\u{3b1}\u{3c2}",
        "\u{3c3}\u{3b1}\u{3c2}",
        "\u{3c3}\u{3b1}\u{3c2}",
    ),
    ("\u{130}stanbul", "istanbul", "i\u{307}stanbul", "istanbul"),
    ("\u{df}", "\u{df}", "\u{df}", "\u{df}"),
    ("\u{fb01}", "\u{fb01}", "\u{fb01}", "\u{fb01}"),
    ("e\u{301}", "e", "e\u{301}", "e"),
    ("\u{c5}", "a", "\u{e5}", "a"),
    ("\u{1e31}", "k", "\u{1e31}", "k"),
    ("\u{152}uvre", "\u{153}uvre", "\u{153}uvre", "\u{153}uvre"),
    (
        "\u{ff37}\u{ff49}\u{ff44}\u{ff45}",
        "\u{ff57}\u{ff49}\u{ff44}\u{ff45}",
        "\u{ff57}\u{ff49}\u{ff44}\u{ff45}",
        "\u{ff57}\u{ff49}\u{ff44}\u{ff45}",
    ),
    (
        "\u{645}\u{64f}\u{62d}\u{64e}\u{645}\u{64e}\u{651}\u{62f}",
        "\u{645}\u{64f}\u{62d}\u{64e}\u{645}\u{64e}\u{651}\u{62f}",
        "\u{645}\u{64f}\u{62d}\u{64e}\u{645}\u{64e}\u{651}\u{62f}",
        "\u{645}\u{62d}\u{645}\u{62f}",
    ),
    (
        "\u{645}\u{64f}\u{62d}\u{64e}\u{645}\u{64e}\u{651}\u{62f}\u{64c}",
        "\u{645}\u{64f}\u{62d}\u{64e}\u{645}\u{64e}\u{651}\u{62f}\u{64c}",
        "\u{645}\u{64f}\u{62d}\u{64e}\u{645}\u{64e}\u{651}\u{62f}\u{64c}",
        "\u{645}\u{62d}\u{645}\u{62f}",
    ),
    (
        "\u{642}\u{64f}\u{631}\u{652}\u{622}\u{646}",
        "\u{642}\u{64f}\u{631}\u{652}\u{622}\u{646}",
        "\u{642}\u{64f}\u{631}\u{652}\u{622}\u{646}",
        "\u{642}\u{631}\u{627}\u{646}",
    ),
    (
        "\u{670}\u{627}",
        "\u{670}\u{627}",
        "\u{670}\u{627}",
        "\u{627}",
    ),
    (
        "\u{6d6}\u{627}",
        "\u{6d6}\u{627}",
        "\u{6d6}\u{627}",
        "\u{627}",
    ),
    ("", "", "", ""),
    ("abc", "abc", "abc", "abc"),
    (
        "\u{65e5}\u{672c}\u{8a9e}",
        "\u{65e5}\u{672c}\u{8a9e}",
        "\u{65e5}\u{672c}\u{8a9e}",
        "\u{65e5}\u{672c}\u{8a9e}",
    ),
    (
        "\u{d55c}\u{ad6d}\u{c5b4}",
        "\u{d55c}\u{ad6d}\u{c5b4}",
        "\u{d55c}\u{ad6d}\u{c5b4}",
        "\u{d55c}\u{ad6d}\u{c5b4}",
    ),
    ("\u{20000}x", "\u{20000}x", "\u{20000}x", "\u{20000}x"),
    (
        "\u{1d400}\u{1d401}",
        "\u{1d400}\u{1d401}",
        "\u{1d400}\u{1d401}",
        "\u{1d400}\u{1d401}",
    ),
    ("\u{1c4}", "\u{1c6}", "\u{1c6}", "\u{1c6}"),
    (
        "\u{1f08}\u{3b8}\u{1fc6}\u{3bd}\u{3b1}\u{3b9}",
        "\u{3b1}\u{3b8}\u{3b7}\u{3bd}\u{3b1}\u{3b9}",
        "\u{1f00}\u{3b8}\u{1fc6}\u{3bd}\u{3b1}\u{3b9}",
        "\u{3b1}\u{3b8}\u{3b7}\u{3bd}\u{3b1}\u{3b9}",
    ),
    ("\u{fb00}", "\u{fb00}", "\u{fb00}", "\u{fb00}"),
    ("\u{fb50}", "\u{fb50}", "\u{fb50}", "\u{fb50}"),
    ("\u{a0}x", "\u{a0}x", "\u{a0}x", "\u{a0}x"),
    ("\u{24b6}", "\u{24d0}", "\u{24d0}", "\u{24d0}"),
    ("\u{344}", "", "\u{344}", ""),
    ("\u{958}", "\u{915}\u{93c}", "\u{958}", "\u{915}\u{93c}"),
];

const IS_CJK: &[(char, bool)] = &[
    ('\u{3039}', false),
    ('\u{3040}', true),
    ('\u{30ff}', true),
    ('\u{3100}', false),
    ('\u{33ff}', false),
    ('\u{3400}', true),
    ('\u{4dbf}', true),
    ('\u{4dc0}', false),
    ('\u{4e00}', true),
    ('\u{9fff}', true),
    ('\u{a000}', false),
    ('\u{f8ff}', false),
    ('\u{f900}', true),
    ('\u{faff}', true),
    ('\u{fb00}', false),
    ('\u{abff}', false),
    ('\u{ac00}', true),
    ('\u{d7af}', true),
    ('\u{d7b0}', false),
    ('\u{20000}', false),
    ('\u{41}', false),
    ('\u{3000}', false),
];

#[test]
fn fold_diacritics_matches_typescript() {
    for &(input, plain, arabic) in FOLD {
        assert_eq!(fold_diacritics(input, false), plain, "fold {input:?}");
        assert_eq!(
            fold_diacritics(input, true),
            arabic,
            "fold arabic {input:?}"
        );
    }
}

#[test]
fn process_term_matches_typescript() {
    for &(input, folded, unfolded, arabic) in PROCESS_TERM {
        assert_eq!(
            process_term(input, &options(true, false)),
            folded,
            "default {input:?}"
        );
        assert_eq!(
            process_term(input, &options(false, false)),
            unfolded,
            "no fold {input:?}"
        );
        assert_eq!(
            process_term(input, &options(true, true)),
            arabic,
            "arabic {input:?}"
        );
    }
}

#[test]
fn arabic_folding_needs_diacritic_folding_on() {
    let input = "\u{645}\u{64f}\u{62d}\u{64e}\u{645}\u{64e}\u{651}\u{62f}";
    assert_eq!(process_term(input, &options(false, true)), input);
}

#[test]
fn is_cjk_matches_typescript_ranges() {
    for &(ch, expected) in IS_CJK {
        assert_eq!(is_cjk(ch), expected, "is_cjk U+{:04X}", u32::from(ch));
    }
}

#[test]
fn js_whitespace_is_the_ecmascript_set() {
    let spaces = [
        '\t', '\n', '\u{b}', '\u{c}', '\r', ' ', '\u{a0}', '\u{1680}', '\u{2000}', '\u{2005}',
        '\u{200a}', '\u{2028}', '\u{2029}', '\u{202f}', '\u{205f}', '\u{3000}', '\u{feff}',
    ];
    for ch in spaces {
        assert!(
            is_js_whitespace(ch),
            "U+{:04X} is JS whitespace",
            u32::from(ch)
        );
    }
    for ch in ['\u{85}', '\u{200b}', '\u{180e}', 'a', '_', '\u{0}'] {
        assert!(
            !is_js_whitespace(ch),
            "U+{:04X} is not JS whitespace",
            u32::from(ch)
        );
    }
}

#[test]
fn letter_or_number_is_unicode_l_and_n() {
    // Lu, Ll, Lt, Lm, Lo, Nd, Nl, No.
    for ch in [
        'A', 'z', '\u{1c5}', '\u{2b0}', '\u{4e2d}', '7', '\u{663}', '\u{216b}', '\u{b2}',
    ] {
        assert!(
            is_letter_or_number(ch),
            "U+{:04X} is a letter or number",
            u32::from(ch)
        );
    }
    // Mn, Mc, Pc, Zs, So, Sm, and Other_Alphabetic marks that char::is_alphabetic accepts.
    for ch in [
        '\u{301}', '\u{93e}', '_', ' ', '\u{24b6}', '+', '\u{345}', '-',
    ] {
        assert!(
            !is_letter_or_number(ch),
            "U+{:04X} is not a letter or number",
            u32::from(ch)
        );
    }
}

#[test]
fn utf16_len_counts_code_units() {
    assert_eq!(utf16_len(""), 0);
    assert_eq!(utf16_len("ab"), 2);
    assert_eq!(utf16_len("\u{e9}"), 1);
    assert_eq!(utf16_len("\u{1d400}"), 2);
    assert_eq!(utf16_len("\u{20000}x"), 3);
}
