//! Choosing among an engine's readings of each word, and saying how sure the
//! choice is. A port of `packages/core/src/ink/parts.ts`; see its header for
//! the reasoning behind each rule.
//!
//! Lengths and edit distances count UTF-16 units, and `\p{L}` / `\p{N}` are
//! Unicode general categories, as in the JS.

use std::collections::HashSet;

use unicode_properties::{GeneralCategoryGroup, UnicodeGeneralCategory};

use super::js_math;
use super::recognise::{INK_UNSURE_CONFIDENCE, map_ink_confidence};
use crate::search::js_text::is_js_whitespace;

/// The most an engine's line may score; `1` marks a line a person corrected.
pub const INK_ENGINE_MAX_CONFIDENCE: f64 = 0.95;

/// An engine's line confidence, capped at `INK_ENGINE_MAX_CONFIDENCE` so a machine
/// reading never claims certainty a person's correction would.
#[must_use]
pub fn capped_engine_confidence(conf: f64) -> f64 {
    js_math::min(conf, INK_ENGINE_MAX_CONFIDENCE)
}

/// How much each unsure word costs a line, as a share of its words.
const UNSURE_PENALTY: f64 = 0.5;

/// The most a line with any unsure word may score: under the underline threshold.
const UNSURE_LINE_MAX: f64 = INK_UNSURE_CONFIDENCE - 0.05;

/// Line alternatives offered for correction.
const MAX_LINE_ALTERNATIVES: usize = 4;

/// One word as the engine read it: readings best-first, and the dictionary's
/// verdict on each (absent when the machine had no dictionary).
#[derive(Debug, Clone, PartialEq, Default, serde::Deserialize)]
pub struct InkWordReadings {
    /// Readings, best first.
    pub candidates: Vec<String>,
    #[serde(default)]
    /// Whether the dictionary knows each reading, parallel to `candidates`.
    pub known: Option<Vec<bool>>,
    /// This word and the next read as one, when the dictionary knows the joined reading.
    #[serde(default)]
    pub join: Option<String>,
}

/// A recognised line: text, confidence, and whole-line alternatives (omitted when none).
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct RecognisedLine {
    /// The chosen text.
    pub text: String,
    /// Confidence in `[0, 1]`.
    pub conf: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    /// Other readings of the whole line, best first.
    pub alternatives: Option<Vec<String>>,
}

/// JS `String.prototype.trim`.
fn js_trim(s: &str) -> &str {
    s.trim_matches(is_js_whitespace)
}

/// JS `.length`.
fn utf16_len(s: &str) -> usize {
    s.encode_utf16().count()
}

fn is_letter(ch: char) -> bool {
    ch.general_category_group() == GeneralCategoryGroup::Letter
}

/// `word.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "")`.
fn fold(word: &str) -> String {
    word.to_lowercase()
        .chars()
        .filter(|&ch| {
            matches!(
                ch.general_category_group(),
                GeneralCategoryGroup::Letter | GeneralCategoryGroup::Number
            )
        })
        .collect()
}

/// `/\p{L}/u.test(word)`.
fn has_letters(word: &str) -> bool {
    word.chars().any(is_letter)
}

/// Edit distance over UTF-16 units, stopping early once it passes `limit`.
fn distance_within(a: &[u16], b: &[u16], limit: usize) -> bool {
    if a.len().abs_diff(b.len()) > limit {
        return false;
    }
    let mut previous: Vec<usize> = (0..=b.len()).collect();
    for (i, &ca) in a.iter().enumerate() {
        let mut row = Vec::with_capacity(b.len() + 1);
        row.push(i + 1);
        let mut best = i + 1;
        for (j, &cb) in b.iter().enumerate() {
            let cost = previous[j] + usize::from(ca != cb);
            let value = cost.min(previous[j + 1] + 1).min(row[j] + 1);
            row.push(value);
            best = best.min(value);
        }
        if best > limit {
            return false;
        }
        previous = row;
    }
    previous[b.len()] <= limit
}

/// Whether a misread is close enough to a workspace term that the title
/// post-match will mend it, so it must not be cut in two.
fn near_vocabulary(word: &str, vocabulary: &HashSet<String>) -> bool {
    let folded: Vec<u16> = fold(word).encode_utf16().collect();
    if folded.len() < 5 {
        return false;
    }
    let limit = (folded.len() / 4).max(1);
    vocabulary.iter().any(|term| {
        let term: Vec<u16> = term.encode_utf16().collect();
        term.len() >= 5 && distance_within(&folded, &term, limit)
    })
}

/// `/^[\p{L}]+[-/][\p{L}]+$/u`.
fn is_split_compound(reading: &str) -> bool {
    let Some(at) = reading.find(['-', '/']) else {
        return false;
    };
    let (head, tail) = (&reading[..at], &reading[at + 1..]);
    !head.is_empty()
        && !tail.is_empty()
        && head.chars().all(is_letter)
        && tail.chars().all(is_letter)
}

/// A hyphenated or slashed reading the engine's pick lacks is two words run together.
fn unjoined(reading: &str, top: &str) -> String {
    if top.contains(['-', '/']) || !is_split_compound(reading) {
        return reading.to_owned();
    }
    reading.replacen(['-', '/'], " ", 1)
}

/// Every word of every vocabulary entry, folded: hyphenated terms both whole and in parts.
#[must_use]
pub fn ink_vocabulary_words(vocabulary: &[String]) -> HashSet<String> {
    let mut out = HashSet::new();
    for entry in vocabulary {
        // Empty tokens from runs of whitespace fold to "" and are skipped, as
        // the JS `split(/\s+/)` edge tokens are.
        for token in entry.split(is_js_whitespace) {
            let whole = fold(token);
            if utf16_len(&whole) >= 2 {
                let _ = out.insert(whole);
            }
            for part in token.split(['-', '_', '/']) {
                let folded = fold(part);
                if utf16_len(&folded) >= 3 {
                    let _ = out.insert(folded);
                }
            }
        }
    }
    out
}

#[derive(Debug, Clone)]
struct Chosen {
    text: String,
    sure: bool,
    /// The engine's own pick was a non-word, even if another reading was kept.
    doubted: bool,
    /// The other readings worth offering, best first.
    others: Vec<String>,
}

/// The reading to keep for one word; `None` when it has no non-blank reading.
fn choose_reading(word: &InkWordReadings, vocabulary: &HashSet<String>) -> Option<Chosen> {
    let candidates: Vec<&str> = word
        .candidates
        .iter()
        .map(String::as_str)
        .filter(|c| !js_trim(c).is_empty())
        .collect();
    let top = *candidates.first()?;
    let known = word
        .known
        .as_ref()
        .filter(|known| known.len() == word.candidates.len());
    // `known[word.candidates.indexOf(candidate)]`.
    let is_known = |candidate: &str| -> Option<bool> {
        let known = known?;
        let index = word.candidates.iter().position(|c| c == candidate)?;
        known.get(index).copied()
    };
    let min_length = utf16_len(&fold(top)).min(3);
    let splits_allowed = !near_vocabulary(top, vocabulary);
    let eligible: Vec<&str> = candidates
        .iter()
        .copied()
        .filter(|c| utf16_len(&fold(c)) >= min_length && (splits_allowed || !c.contains(' ')))
        .collect();

    let displaces = |c: &str| -> bool {
        c == top
            || if known.is_some() {
                is_known(top) != Some(true) || is_known(c) == Some(false)
            } else {
                utf16_len(&fold(c)) >= 5
            }
    };
    let in_vocabulary = eligible
        .iter()
        .copied()
        .find(|c| vocabulary.contains(&fold(c)) && displaces(c));
    let (text, sure) = if let Some(term) = in_vocabulary {
        (term.to_owned(), true)
    } else if !has_letters(top) || is_known(top) != Some(false) {
        (top.to_owned(), true)
    } else {
        match eligible.iter().copied().find(|c| is_known(c) == Some(true)) {
            Some(word) => (unjoined(word, top), true),
            None => (top.to_owned(), false),
        }
    };
    let text_folded = fold(&text);
    // Readings the dictionary knows first, otherwise in the engine's order.
    let (mut others, rest): (Vec<String>, Vec<String>) = candidates
        .iter()
        .copied()
        .filter(|&c| {
            let folded = fold(c);
            c != text && folded != text_folded && utf16_len(&folded) >= min_length
        })
        .map(str::to_owned)
        .partition(|c| is_known(c) == Some(true));
    others.extend(rest);
    let doubted = has_letters(top) && is_known(top) == Some(false);
    Some(Chosen {
        text,
        sure,
        doubted,
        others,
    })
}

fn offer(alternatives: &mut Vec<String>, text: &str, line: String) {
    if !line.is_empty() && line != text && !alternatives.contains(&line) {
        alternatives.push(line);
    }
}

/// One line from its words' readings: the chosen text, a confidence under
/// [`INK_ENGINE_MAX_CONFIDENCE`], and whole-line alternatives. `engine_text`,
/// the engine's own line, is offered back first.
#[must_use]
pub fn decode_ink_words(
    words: &[InkWordReadings],
    vocabulary: &[String],
    engine_text: Option<&str>,
) -> RecognisedLine {
    let known = ink_vocabulary_words(vocabulary);
    let read: Vec<(&InkWordReadings, Chosen)> = words
        .iter()
        .filter_map(|word| choose_reading(word, &known).map(|choice| (word, choice)))
        .collect();
    if read.is_empty() {
        return RecognisedLine {
            text: engine_text.map_or("", js_trim).to_owned(),
            conf: 0.0,
            alternatives: None,
        };
    }

    let (chosen, join_offers) = apply_joins(&read, &known);
    let text = chosen
        .iter()
        .map(|c| c.text.as_str())
        .collect::<Vec<_>>()
        .join(" ");
    let unsure = chosen.iter().filter(|c| !c.sure).count();
    let conf = if unsure == 0 {
        INK_ENGINE_MAX_CONFIDENCE
    } else {
        js_math::max(
            0.0,
            js_math::min(
                UNSURE_LINE_MAX,
                INK_ENGINE_MAX_CONFIDENCE - (UNSURE_PENALTY * unsure as f64) / chosen.len() as f64,
            ),
        )
    };
    let alternatives = line_alternatives(&chosen, &join_offers, &text, engine_text);
    RecognisedLine {
        text,
        conf,
        alternatives: (!alternatives.is_empty()).then_some(alternatives),
    }
}

/// The kept words after joins: a join is taken where either half is in doubt
/// or the joined word is a known term, and otherwise kept as a line to offer
/// (`(slot, joined word)`).
fn apply_joins(
    read: &[(&InkWordReadings, Chosen)],
    known: &HashSet<String>,
) -> (Vec<Chosen>, Vec<(usize, String)>) {
    let doubt = |c: &Chosen| !c.sure || c.doubted;
    let mut chosen: Vec<Chosen> = Vec::new();
    let mut join_offers: Vec<(usize, String)> = Vec::new();
    let mut index = 0;
    while index < read.len() {
        let (word, choice) = &read[index];
        let join = word.join.as_deref().map(js_trim).filter(|j| !j.is_empty());
        if let (Some(join), Some((_, next))) = (join, read.get(index + 1)) {
            if doubt(choice) || doubt(next) || known.contains(&fold(join)) {
                // The previous word's offer would swap its join into this slot.
                if join_offers.last().map(|(at, _)| *at) == chosen.len().checked_sub(1) {
                    let _ = join_offers.pop();
                }
                chosen.push(Chosen {
                    text: join.to_owned(),
                    sure: true,
                    doubted: false,
                    others: vec![format!("{} {}", choice.text, next.text)],
                });
                index += 2;
                continue;
            }
            join_offers.push((chosen.len(), join.to_owned()));
        }
        chosen.push(choice.clone());
        index += 1;
    }
    (chosen, join_offers)
}

/// Whole-line alternatives, best first: the engine's own line, the offered
/// joins, then one word swapped at a time, doubtful words first.
fn line_alternatives(
    chosen: &[Chosen],
    join_offers: &[(usize, String)],
    text: &str,
    engine_text: Option<&str>,
) -> Vec<String> {
    let mut alternatives: Vec<String> = Vec::new();
    if let Some(engine) = engine_text {
        offer(&mut alternatives, text, js_trim(engine).to_owned());
    }
    for (at, join) in join_offers {
        let line = chosen
            .iter()
            .enumerate()
            .filter_map(|(i, w)| match i {
                i if i == *at => Some(join.as_str()),
                i if i == at + 1 => None,
                _ => Some(w.text.as_str()),
            })
            .collect::<Vec<_>>()
            .join(" ");
        offer(&mut alternatives, text, line);
    }
    // Doubtful words first, then left to right: the swap most likely to be the fix.
    let order: Vec<usize> = (0..chosen.len())
        .filter(|&i| !chosen[i].sure)
        .chain((0..chosen.len()).filter(|&i| chosen[i].sure))
        .collect();
    for round in 0..2 {
        if alternatives.len() >= MAX_LINE_ALTERNATIVES {
            break;
        }
        for &index in &order {
            let Some(other) = chosen[index].others.get(round) else {
                continue;
            };
            let line = chosen
                .iter()
                .enumerate()
                .map(|(i, w)| {
                    if i == index {
                        other.as_str()
                    } else {
                        w.text.as_str()
                    }
                })
                .collect::<Vec<_>>()
                .join(" ");
            offer(&mut alternatives, text, line);
            if alternatives.len() >= MAX_LINE_ALTERNATIVES {
                break;
            }
        }
    }
    alternatives
}

/// One line as the Windows Ink helper returns it. `confidence` only says the
/// helper produced text or not; `words` is the evidence when it sent any.
#[derive(Debug, Clone, PartialEq, Default, serde::Deserialize)]
pub struct HelperLine {
    /// The helper's text for the line.
    pub text: String,
    /// The helper's confidence, `1` for any produced text.
    pub confidence: f64,
    /// Each word's readings, when the helper sent them.
    #[serde(default)]
    pub words: Option<Vec<InkWordReadings>>,
    /// The helper's own whole-line alternatives.
    #[serde(default)]
    pub alternatives: Option<Vec<String>>,
}

/// A helper line as a scored line. With text and per-word readings, the readings
/// decide the text and score. Otherwise the line keeps its text, its alternatives
/// (when it has any), and the engine confidence capped under certainty: `1` is a
/// person's correction, never an engine's.
#[must_use]
pub fn helper_line(line: &HelperLine, vocabulary: &[String]) -> RecognisedLine {
    match line.words.as_deref() {
        Some(words) if !line.text.is_empty() && !words.is_empty() => {
            decode_ink_words(words, vocabulary, Some(&line.text))
        }
        _ => RecognisedLine {
            text: line.text.clone(),
            conf: capped_engine_confidence(map_ink_confidence(line.confidence, 1.0)),
            alternatives: line.alternatives.clone().filter(|a| !a.is_empty()),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn engine_confidence_is_capped_below_certainty() {
        assert_eq!(capped_engine_confidence(0.99), INK_ENGINE_MAX_CONFIDENCE);
        assert_eq!(capped_engine_confidence(0.4), 0.4);
    }

    fn word(candidates: &[&str], known: Option<&[bool]>, join: Option<&str>) -> InkWordReadings {
        InkWordReadings {
            candidates: candidates.iter().map(|s| (*s).to_owned()).collect(),
            known: known.map(<[bool]>::to_vec),
            join: join.map(str::to_owned),
        }
    }

    #[test]
    fn prefers_a_dictionary_word_over_the_engines_non_word() {
        let line = decode_ink_words(
            &[word(&["lorown", "brown"], Some(&[false, true]), None)],
            &[],
            Some("lorown"),
        );
        assert_eq!(line.text, "brown");
        assert_eq!(line.conf, INK_ENGINE_MAX_CONFIDENCE);
        assert_eq!(line.alternatives, Some(vec!["lorown".to_owned()]));
    }

    #[test]
    fn a_vocabulary_term_beats_a_non_word() {
        let line = decode_ink_words(
            &[word(&["softrnax", "softmax"], Some(&[false, false]), None)],
            &["Softmax attention".to_owned()],
            None,
        );
        assert_eq!(line.text, "softmax");
    }

    #[test]
    fn an_unsure_word_puts_the_line_under_the_threshold() {
        let line = decode_ink_words(
            &[
                word(&["the"], Some(&[true]), None),
                word(&["qzx"], Some(&[false]), None),
            ],
            &[],
            None,
        );
        assert!(line.conf < INK_UNSURE_CONFIDENCE);
    }

    #[test]
    fn a_doubtful_half_takes_the_join() {
        let line = decode_ink_words(
            &[
                word(&["dr"], Some(&[false]), Some("draft")),
                word(&["aft"], Some(&[true]), None),
            ],
            &[],
            None,
        );
        assert_eq!(line.text, "draft");
        assert_eq!(line.alternatives, Some(vec!["dr aft".to_owned()]));
    }

    #[test]
    fn no_readings_falls_back_to_the_engine_text() {
        let line = decode_ink_words(&[word(&[" "], None, None)], &[], Some("  hi "));
        assert_eq!(line.text, "hi");
        assert_eq!(line.conf, 0.0);
        assert_eq!(line.alternatives, None);
    }

    #[test]
    fn edit_distance_stops_past_the_limit() {
        let a: Vec<u16> = "ablation".encode_utf16().collect();
        let b: Vec<u16> = "alolation".encode_utf16().collect();
        assert!(distance_within(&a, &b, 2));
        assert!(!distance_within(&a, &b, 1));
    }

    // it: "a helper line with per-word readings is decoded, not scored by its confidence"
    #[test]
    fn a_helper_line_with_words_is_decoded() {
        let line = helper_line(
            &HelperLine {
                text: "lorown".to_owned(),
                confidence: 1.0,
                words: Some(vec![word(&["lorown", "brown"], Some(&[false, true]), None)]),
                alternatives: None,
            },
            &[],
        );
        assert_eq!(line.text, "brown");
        assert_eq!(line.conf, INK_ENGINE_MAX_CONFIDENCE);
        assert_eq!(line.alternatives, Some(vec!["lorown".to_owned()]));
    }

    // it: "a helper line without words keeps its text and caps its confidence under certainty"
    #[test]
    fn a_helper_line_without_words_is_capped_and_keeps_its_text() {
        let line = helper_line(
            &HelperLine {
                text: "hello".to_owned(),
                confidence: 1.0,
                words: None,
                alternatives: None,
            },
            &[],
        );
        assert_eq!(line.text, "hello");
        assert_eq!(line.conf, INK_ENGINE_MAX_CONFIDENCE);
        assert_eq!(line.alternatives, None);
    }

    // it: "an empty word list counts as no words, and empty alternatives are dropped"
    #[test]
    fn empty_words_fall_back_and_empty_alternatives_are_omitted() {
        let line = helper_line(
            &HelperLine {
                text: "hi".to_owned(),
                confidence: 0.5,
                words: Some(Vec::new()),
                alternatives: Some(Vec::new()),
            },
            &[],
        );
        assert_eq!(line.text, "hi");
        assert!(line.conf < 1.0);
        assert_eq!(line.alternatives, None);

        let kept = helper_line(
            &HelperLine {
                text: "hi".to_owned(),
                confidence: 0.5,
                words: None,
                alternatives: Some(vec!["ho".to_owned()]),
            },
            &[],
        );
        assert_eq!(kept.alternatives, Some(vec!["ho".to_owned()]));
    }
}
