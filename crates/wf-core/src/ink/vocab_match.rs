//! Near-miss vocabulary matching for recognised ink text: a port of
//! `apps/web/src/features/ink/application/vocab-match.ts`.
//!
//! A handwriting engine writes an unseen title or citation key as whatever it
//! looks like. Each vocabulary entry is slid over the recognised words, and a
//! near-miss is rewritten to the exact entry. `[[…]]` spans are matched first
//! and on their own; the symbol map then rewrites arrows and comparisons that
//! sit between spaces.

use serde::Serialize;

use crate::search::js_text::{is_js_whitespace, utf16_len};

/// One rewrite: the words as the engine wrote them, and the entry they became.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct VocabMatch {
    /// The words as the engine wrote them.
    pub from: String,
    /// The vocabulary entry they were rewritten to.
    pub to: String,
}

/// The rewritten line and every rewrite made in it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct VocabMatchResult {
    /// The line after the rewrites.
    pub text: String,
    /// The rewrites, in the order they were made.
    pub matches: Vec<VocabMatch>,
}

/// The arrows and comparisons a researcher writes, mapped once (§5.4).
pub const INK_SYMBOL_MAP: &[(&str, &str)] = &[
    ("->", "→"),
    ("<-", "←"),
    ("<=", "≤"),
    (">=", "≥"),
    ("!=", "≠"),
    ("=>", "⇒"),
];

/// How far a single word may be from an entry's word.
pub const VOCAB_WORD_DISTANCE: usize = 2;
/// How far the whole span may be, as a share of the entry's length.
pub const VOCAB_SPAN_RATIO: f64 = 0.25;

/// Damerau–Levenshtein with adjacent transpositions (the restricted form), which
/// is the edit an engine most often makes. Counts UTF-16 units, as JS does.
#[must_use]
pub fn damerau_levenshtein(a: &str, b: &str) -> usize {
    let a: Vec<u16> = a.encode_utf16().collect();
    let b: Vec<u16> = b.encode_utf16().collect();
    let (m, n) = (a.len(), b.len());
    if m == 0 {
        return n;
    }
    if n == 0 {
        return m;
    }
    let mut previous2: Vec<usize> = Vec::new();
    let mut previous: Vec<usize> = (0..=n).collect();
    for i in 1..=m {
        let mut current = vec![i];
        for j in 1..=n {
            let cost = usize::from(a[i - 1] != b[j - 1]);
            let mut value = (previous[j] + 1)
                .min(current[j - 1] + 1)
                .min(previous[j - 1] + cost);
            if i > 1 && j > 1 && a[i - 1] == b[j - 2] && a[i - 2] == b[j - 1] {
                value = value.min(previous2[j - 2] + 1);
            }
            current.push(value);
        }
        previous2 = previous;
        previous = current;
    }
    previous[n]
}

/// Lower-case, keeping only letters and numbers (the TS `fold`).
fn fold(word: &str) -> String {
    word.to_lowercase()
        .chars()
        .filter(|&c| is_word_char(c))
        .collect()
}

fn is_word_char(c: char) -> bool {
    c.is_alphabetic() || c.is_numeric()
}

/// Split on JS whitespace, dropping empty pieces.
fn split_words(text: &str) -> Vec<&str> {
    text.split(is_js_whitespace)
        .filter(|word| !word.is_empty())
        .collect()
}

/// The distance between a run of recognised words and an entry, or `None` when
/// any word is further than [`VOCAB_WORD_DISTANCE`] or the total is over
/// [`VOCAB_SPAN_RATIO`] of the entry (the TS `Infinity`).
#[must_use]
pub fn span_distance(words: &[&str], entry_words: &[&str]) -> Option<usize> {
    if words.len() != entry_words.len() || words.is_empty() {
        return None;
    }
    let mut total = 0;
    let mut length = 0;
    for (word, entry_word) in words.iter().zip(entry_words) {
        let a = fold(word);
        let b = fold(entry_word);
        let distance = damerau_levenshtein(&a, &b);
        if distance > VOCAB_WORD_DISTANCE {
            return None;
        }
        total += distance;
        length += utf16_len(&b);
    }
    let allowed = (length as f64 * VOCAB_SPAN_RATIO).floor() as usize;
    (total <= allowed).then_some(total)
}

/// Rewrite one span of words to the closest entry, if one is close enough.
fn match_span(span: &str, vocabulary: &[&str], matches: &mut Vec<VocabMatch>) -> String {
    let words = split_words(span);
    if words.is_empty() {
        return span.to_owned();
    }
    let trimmed = words.join(" ");
    let mut best: Option<(&str, usize)> = None;
    for &entry in vocabulary {
        let entry_words = split_words(entry);
        let Some(distance) = span_distance(&words, &entry_words) else {
            continue;
        };
        if best.is_none_or(|(_, current)| distance < current) {
            best = Some((entry, distance));
        }
    }
    match best {
        Some((entry, _)) if fold(entry) != fold(&trimmed) => {
            matches.push(VocabMatch {
                from: trimmed,
                to: entry.to_owned(),
            });
            entry.to_owned()
        }
        _ => span.to_owned(),
    }
}

/// The byte ranges of every `[[…]]` span with a non-empty inside (the regex
/// `\[\[([^\]]+)\]\]`, leftmost and non-overlapping).
fn wikilink_spans(text: &str) -> Vec<(usize, usize)> {
    let bytes = text.as_bytes();
    let mut spans = Vec::new();
    let mut i = 0;
    while i + 1 < bytes.len() {
        if bytes[i] == b'['
            && bytes[i + 1] == b'['
            && let Some(offset) = bytes[i + 2..].iter().position(|&b| b == b']')
        {
            let close = i + 2 + offset;
            if close > i + 2 && bytes.get(close + 1) == Some(&b']') {
                spans.push((i, close + 2));
                i = close + 2;
                continue;
            }
        }
        i += 1;
    }
    spans
}

/// Split a plain run into words and the whitespace between them, the way
/// `split(/(\s+)/)` does: always starts and ends with a word, possibly empty.
fn split_keep_space(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut buf = String::new();
    let mut in_space = false;
    for c in text.chars() {
        let space = is_js_whitespace(c);
        if space != in_space {
            out.push(std::mem::take(&mut buf));
            in_space = space;
        }
        buf.push(c);
    }
    out.push(buf);
    if in_space {
        out.push(String::new());
    }
    out
}

fn word_at(tokens: &[String], index: usize) -> &str {
    tokens.get(index * 2).map_or("", String::as_str)
}

/// The non-alphanumeric prefix and suffix of a word, which the rewrite keeps.
fn surrounding_punctuation(word: &str) -> (&str, &str) {
    let core = word.trim_start_matches(|c| !is_word_char(c));
    let leading = &word[..word.len() - core.len()];
    let core = core.trim_end_matches(|c| !is_word_char(c));
    let trailing = &word[leading.len() + core.len()..];
    (leading, trailing)
}

/// Rewrite the windows of plain words that match an entry, longest entries first.
fn match_words(
    part: &str,
    lengths: &[usize],
    entries: &[&str],
    matches: &mut Vec<VocabMatch>,
) -> String {
    let mut tokens = split_keep_space(part);
    for &length in lengths {
        let mut i = 0;
        while i + length <= tokens.len().div_ceil(2) {
            let window: Vec<&str> = (0..length).map(|k| word_at(&tokens, i + k)).collect();
            if window.iter().any(|word| word.is_empty()) {
                i += 1;
                continue;
            }
            let before = matches.len();
            let replaced = match_span(&window.join(" "), entries, matches);
            if matches.len() > before {
                let (leading, _) = surrounding_punctuation(window[0]);
                let (_, trailing) = surrounding_punctuation(window[length - 1]);
                let joined = format!("{leading}{replaced}{trailing}");
                drop(tokens.splice(i * 2..i * 2 + length * 2 - 1, std::iter::once(joined)));
            }
            i += 1;
        }
    }
    tokens.concat()
}

/// Rewrite the near-misses in one line, then the symbols.
///
/// Wikilinks first, whole; then every window of the line's remaining words the
/// length of some entry, longest entries first, so "Graph-prior module" wins
/// over a one-word "module". A window that matched is skipped over, not re-matched.
#[must_use]
pub fn match_vocabulary(text: &str, vocabulary: &[String]) -> VocabMatchResult {
    let mut matches = Vec::new();
    let entries: Vec<&str> = vocabulary
        .iter()
        .map(|entry| entry.trim_matches(is_js_whitespace))
        .filter(|entry| !entry.is_empty())
        .collect();

    let mut out = String::new();
    let mut pos = 0;
    for (start, end) in wikilink_spans(text) {
        out.push_str(&text[pos..start]);
        let inner = &text[start + 2..end - 2];
        let mut parts = inner.split('|');
        let target = parts.next().unwrap_or_default();
        let fixed = match_span(
            target.trim_matches(is_js_whitespace),
            &entries,
            &mut matches,
        );
        match parts.next() {
            Some(alias) => out.push_str(&format!("[[{fixed}|{alias}]]")),
            None => out.push_str(&format!("[[{fixed}]]")),
        }
        pos = end;
    }
    out.push_str(&text[pos..]);

    // Outside the links: the plain words, with the links masked so they are
    // neither matched twice nor split by the window.
    let mut lengths: Vec<usize> = entries.iter().map(|e| split_words(e).len()).collect();
    lengths.sort_unstable_by(|a, b| b.cmp(a));
    lengths.dedup();

    let mut parts: Vec<&str> = Vec::new();
    let mut cursor = 0;
    let spans = wikilink_spans(&out);
    for &(start, end) in &spans {
        parts.push(&out[cursor..start]);
        parts.push(&out[start..end]);
        cursor = end;
    }
    parts.push(&out[cursor..]);

    let mut rebuilt = String::new();
    for part in parts {
        if part.starts_with("[[") {
            rebuilt.push_str(part);
        } else {
            rebuilt.push_str(&match_words(part, &lengths, &entries, &mut matches));
        }
    }

    for (from, to) in INK_SYMBOL_MAP {
        rebuilt = rebuilt.replace(&format!(" {from} "), &format!(" {to} "));
    }
    VocabMatchResult {
        text: rebuilt,
        matches,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vocab(entries: &[&str]) -> Vec<String> {
        entries.iter().map(|e| (*e).to_owned()).collect()
    }

    #[test]
    fn damerau_levenshtein_counts_a_transposition_as_one_edit() {
        assert_eq!(damerau_levenshtein("module", "modlue"), 1);
        assert_eq!(damerau_levenshtein("graph", "graph"), 0);
        assert_eq!(damerau_levenshtein("", "abc"), 3);
        assert_eq!(damerau_levenshtein("kitten", "sitting"), 3);
    }

    #[test]
    fn span_distance_refuses_a_word_further_than_2_or_a_span_over_25_percent() {
        assert_eq!(
            span_distance(&["Graph-prior", "modlue"], &["Graph-prior", "module"]),
            Some(1)
        );
        assert_eq!(
            span_distance(&["Grph", "mdle"], &["Graph-prior", "module"]),
            None
        );
        // 3 letters x 25 % rounds down to 0 edits.
        assert_eq!(span_distance(&["cat"], &["cut"]), None);
        assert_eq!(span_distance(&["a", "b"], &["a"]), None);
    }

    #[test]
    fn a_near_miss_inside_wikilink_becomes_the_exact_title() {
        let result = match_vocabulary(
            "see [[Graph-prior modlue]] for the proof",
            &vocab(&["Graph-prior module"]),
        );
        assert_eq!(result.text, "see [[Graph-prior module]] for the proof");
        assert_eq!(
            result.matches,
            vec![VocabMatch {
                from: "Graph-prior modlue".to_owned(),
                to: "Graph-prior module".to_owned(),
            }]
        );
    }

    #[test]
    fn an_alias_is_kept_and_only_the_target_is_rewritten() {
        let result = match_vocabulary(
            "[[Grap-prior module|the module]]",
            &vocab(&["Graph-prior module"]),
        );
        assert_eq!(result.text, "[[Graph-prior module|the module]]");
    }

    #[test]
    fn plain_words_match_a_multi_word_title_keeping_punctuation_longest_first() {
        let result = match_vocabulary(
            "Compare graph-pror module, then smith2O21.",
            &vocab(&["module", "Graph-prior module", "smith2021"]),
        );
        assert_eq!(result.text, "Compare Graph-prior module, then smith2021.");
        assert_eq!(result.matches.len(), 2);
    }

    #[test]
    fn an_exact_word_is_left_alone_and_model_does_not_become_module() {
        let result = match_vocabulary("the model and the module", &vocab(&["module"]));
        assert_eq!(result.text, "the model and the module");
        assert!(result.matches.is_empty());
    }

    #[test]
    fn the_symbol_map_rewrites_arrows_and_comparisons_between_spaces() {
        assert_eq!(
            match_vocabulary("x -> y and a <= b", &[]).text,
            "x → y and a ≤ b"
        );
        assert_eq!(
            match_vocabulary("a->b", &[]).text,
            "a->b",
            "glued symbols are left to the writer"
        );
    }

    #[test]
    fn an_unclosed_wikilink_is_plain_text() {
        let result = match_vocabulary("[[Graph-prior modlue", &vocab(&["Graph-prior module"]));
        assert_eq!(result.text, "[[Graph-prior modlue");
    }
}
