//! Port of packages/core/src/features/ai-assistant/domain/lexical-concept-extractor.ts. Pure.
//!
//! Positions are UTF-16 units, as in the TS, so offsets and evidence snippets
//! match what the JS side computed.

use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;

use regex_lite::Regex;
use serde::Deserialize;

use crate::ai::extraction::{
    ExtractedConcept, ExtractedMention, ExtractionResult, concept_key, js_slice_keep,
};
use crate::papers::js_regex::{compile, space_class};
use crate::papers::paper::extract_hashtag_refs;
use crate::reader_analysis::lines::js_trim;
use crate::search::js_text::{is_js_whitespace, utf16_len};
use crate::vault::page::extract_wikilinks;

/// A concept needs this many documents unless a user stated it outright.
const MIN_MENTIONS: usize = 2;
/// UTF-16 units of context either side of a snippet.
const CONTEXT_UNITS: usize = 60;

const STOPWORDS: &[&str] = &[
    "the",
    "a",
    "an",
    "this",
    "that",
    "these",
    "those",
    "we",
    "it",
    "our",
    "their",
    "i",
    "he",
    "she",
    "they",
    "there",
    "here",
    "in",
    "on",
    "at",
    "for",
    "with",
    "and",
    "but",
    "or",
    "if",
    "when",
    "while",
    "as",
    "by",
    "to",
    "from",
    "of",
    "however",
    "therefore",
    "thus",
    "first",
    "second",
    "finally",
    "note",
    "see",
    "figure",
    "table",
    "section",
    "chapter",
    "appendix",
];

/// Where a mention came from. A tag or link is stated; a capitalised phrase is guessed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Strength {
    Stated,
    Guessed,
}

/// One note or paper the lexical extractor reads (TS `ExtractionDocument`).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct LexicalDocument {
    /// Note or paper id.
    pub id: String,
    /// The text read; absent reads as empty.
    #[serde(default)]
    pub text: Option<String>,
}

/// The lexical extractor's input (TS `ExtractionRequest`, the fields it reads).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct LexicalRequest {
    /// Documents to read.
    pub documents: Vec<LexicalDocument>,
    /// Keep at most this many concepts; zero or absent means no cap.
    #[serde(default)]
    pub max_concepts: Option<f64>,
}

/// A document prepared once, with both the raw and the markdown-stripped text.
struct Prepared {
    id: String,
    raw: String,
    raw16: Vec<u16>,
    plain: String,
    plain16: Vec<u16>,
}

/// One signal read from a document (TS `HarvestedMention`).
struct Harvested {
    key: String,
    name: String,
    kind: &'static str,
    kind_recognised: bool,
    strength: Strength,
    document_id: String,
    evidence: String,
    /// True when the only capitalised use so far opens a sentence.
    opening: bool,
}

/// A concept while mentions are being merged (TS `ConceptEntry`).
struct Entry {
    key: String,
    name: String,
    kind: &'static str,
    kind_recognised: bool,
    strength: Strength,
    documents: HashSet<String>,
    named: bool,
}

fn is_stopword(word: &str) -> bool {
    STOPWORDS.contains(&word)
}

/// `^[A-Z]{2,6}$`.
fn is_acronym(text: &str) -> bool {
    (2..=6).contains(&text.len()) && text.bytes().all(|b| b.is_ascii_uppercase())
}

/// The acronyms the kind tables know, keyed by upper-case spelling.
fn known_acronym_kind(upper: &str) -> Option<&'static str> {
    match upper {
        "ICLR" | "NEURIPS" | "NIPS" | "ICML" | "ACL" | "EMNLP" | "NAACL" | "COLING" | "CVPR"
        | "ICCV" | "ECCV" | "AAAI" | "IJCAI" | "SIGIR" | "KDD" | "WWW" | "TACL" => Some("venue"),
        "MNIST" | "CIFAR" | "CIFAR10" | "CIFAR100" | "SVHN" | "COCO" | "GLUE" | "SQUAD"
        | "IMAGENET" | "TINYIMAGENET" | "PASCAL" | "KITTI" | "WMT" | "PTB" | "IMDB"
        | "LIBRISPEECH" | "MMLU" | "SST" | "SNLI" | "MULTINLI" => Some("dataset"),
        "BLEU" | "ROUGE" | "METEOR" | "AUC" | "ROC" | "MAP" | "MSE" | "RMSE" | "MAE" | "PPL"
        | "IOU" | "FID" | "WER" | "CER" | "F1" => Some("metric"),
        _ => None,
    }
}

/// The kind a name is recognised as, or `None` when no rule fires.
fn kind_for(name: &str) -> Option<&'static str> {
    if let Some(kind) = known_acronym_kind(&name.to_uppercase()) {
        return Some(kind);
    }
    if is_acronym(name) {
        return Some("method");
    }
    if dataset_keyword_re().is_match(name) {
        return Some("dataset");
    }
    if metric_keyword_re().is_match(name) {
        return Some("metric");
    }
    if venue_keyword_re().is_match(name) {
        return Some("venue");
    }
    None
}

/// The kind and whether a rule recognised it. An unrecognised name is a generic
/// concept when stated and a method when only guessed.
fn classify(name: &str, strength: Strength) -> (&'static str, bool) {
    match kind_for(name) {
        Some(kind) => (kind, true),
        None => match strength {
            Strength::Stated => ("concept", false),
            Strength::Guessed => ("method", false),
        },
    }
}

fn informativeness(kind: &str) -> u8 {
    match kind {
        "concept" => 0,
        "method" => 1,
        _ => 2,
    }
}

/// Whether `text[index]` starts a sentence, looking back past markup and list markers.
fn opens_sentence(text: &[u16], index: usize) -> bool {
    // `i` is one past the character being looked at, so 0 means "before the start".
    let mut i = index;
    while i > 0
        && matches!(
            text[i - 1],
            0x20 | 0x09 | 0x22 | 0x27 | 0x28 | 0x201C | 0x5B | 0x2A | 0x5F
        )
    {
        i -= 1;
    }
    if i == 0 {
        return true;
    }
    let c = text[i - 1];
    if matches!(c, 0x0A | 0x2E | 0x21 | 0x3F | 0x3A | 0x3B | 0x7C) {
        return true;
    }
    // `-`, `*`, `+`, `>` are list or quote markers.
    if !matches!(c, 0x2D | 0x2A | 0x2B | 0x3E) {
        return false;
    }
    i -= 1;
    while i > 0 && matches!(text[i - 1], 0x20 | 0x09) {
        i -= 1;
    }
    i == 0 || text[i - 1] == 0x0A
}

/// A phrase is a name when its first word is not a stopword and not every word is one.
fn is_plausible_name(phrase: &str) -> bool {
    let trimmed = js_trim(phrase);
    if utf16_len(trimmed) < 3 {
        return false;
    }
    let words: Vec<&str> = trimmed
        .split(is_js_whitespace)
        .filter(|word| !word.is_empty())
        .collect();
    let Some(first) = words.first() else {
        return false;
    };
    if is_stopword(&first.to_lowercase()) {
        return false;
    }
    words.iter().any(|word| !is_stopword(&word.to_lowercase()))
}

/// `"VAEs"` is `"VAE"` (E38): an acronym with a plural `s` is the same concept.
fn strip_plural_acronym(name: &str) -> String {
    match name.strip_suffix('s') {
        Some(stem) if is_acronym(stem) => stem.to_string(),
        _ => name.to_string(),
    }
}

/// UTF-16 units of a slice of the text, from `start` up to `end`.
fn snippet(text: &[u16], index: usize, length: usize) -> String {
    let end = (index + length + CONTEXT_UNITS).min(text.len());
    let start = index.saturating_sub(CONTEXT_UNITS).min(end);
    let raw = String::from_utf16_lossy(&text[start..end]);
    let body = js_trim(&raw);
    format!(
        "{}{}{}",
        if start > 0 { "…" } else { "" },
        body,
        if end < text.len() { "…" } else { "" },
    )
}

/// `(token, offset)` for each `[A-Za-z0-9]+` run in `text`, offsets in UTF-16 units.
fn token_offsets(text: &str) -> Vec<(String, usize)> {
    let mut out = Vec::new();
    let mut units = 0usize;
    let mut start: Option<usize> = None;
    let mut current = String::new();
    for ch in text.chars() {
        if ch.is_ascii_alphanumeric() {
            if start.is_none() {
                start = Some(units);
            }
            current.push(ch);
        } else if let Some(at) = start.take() {
            out.push((std::mem::take(&mut current), at));
        }
        units += ch.len_utf16();
    }
    if let Some(at) = start {
        out.push((current, at));
    }
    out
}

/// The text with `[[wikilinks]]` blanked to spaces, UTF-16 length preserved.
fn without_wikilinks(text: &str) -> String {
    wikilink_blank_re()
        .replace_all(text, |caps: &regex_lite::Captures| {
            " ".repeat(utf16_len(&caps[0]))
        })
        .into_owned()
}

/// The text with markdown that is not prose blanked out.
fn strip_markdown(text: &str) -> String {
    let text = fence_re().replace_all(text, " ").into_owned();
    let text = code_span_re().replace_all(&text, " ").into_owned();
    let text = image_re().replace_all(&text, " ").into_owned();
    let text = bracket_link_re().replace_all(&text, " ").into_owned();
    heading_re().replace_all(&text, "").into_owned()
}

fn prepare(source: &LexicalDocument) -> Prepared {
    let raw = source.text.clone().unwrap_or_default();
    let plain = strip_markdown(&raw);
    Prepared {
        id: source.id.clone(),
        raw16: raw.encode_utf16().collect(),
        plain16: plain.encode_utf16().collect(),
        raw,
        plain,
    }
}

fn stated(doc: &Prepared, name: &str, index: usize, length: usize) -> Harvested {
    let (kind, recognised) = classify(name, Strength::Stated);
    Harvested {
        key: concept_key(name),
        name: name.to_string(),
        kind,
        kind_recognised: recognised,
        strength: Strength::Stated,
        document_id: doc.id.clone(),
        evidence: snippet(&doc.raw16, index, length),
        opening: false,
    }
}

/// Hashtags and wikilinks, which the user wrote on purpose.
fn harvest_stated(doc: &Prepared) -> Vec<Harvested> {
    let mut out = Vec::new();
    let without_links = without_wikilinks(&doc.raw);
    for tag in extract_hashtag_refs(Some(&without_links)) {
        out.push(stated(doc, &tag.tag, tag.index, tag.length));
    }
    for link in extract_wikilinks(&doc.raw) {
        // `[[#Heading]]` and `[[|alias]]` name nothing to file.
        let target = js_trim(&link.target);
        if target.is_empty() {
            continue;
        }
        // Offsets come from extract_wikilinks: whole, non-negative UTF-16 indices.
        #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
        out.push(stated(
            doc,
            target,
            link.index.unwrap_or(0.0) as usize,
            link.length.unwrap_or(0.0) as usize,
        ));
    }
    out
}

/// Records one guessed name, merging a repeat within the same document.
fn record_guessed(
    doc: &Prepared,
    out: &mut Vec<Harvested>,
    seen: &mut HashMap<String, usize>,
    name: &str,
    index: usize,
    length: usize,
) {
    let trimmed = strip_plural_acronym(js_trim(name));
    if !is_plausible_name(&trimmed) {
        return;
    }
    let key = concept_key(&trimmed);
    let opening = plain_word_re().is_match(&trimmed) && opens_sentence(&doc.plain16, index);
    if let Some(&pos) = seen.get(&key) {
        // One mid-sentence use is enough to make the word a name.
        let existing = &mut out[pos];
        if existing.opening && !opening {
            existing.opening = false;
        }
        return;
    }
    let (kind, recognised) = classify(&trimmed, Strength::Guessed);
    let _ = seen.insert(key.clone(), out.len());
    out.push(Harvested {
        key,
        name: trimmed,
        kind,
        kind_recognised: recognised,
        strength: Strength::Guessed,
        document_id: doc.id.clone(),
        evidence: snippet(&doc.plain16, index, length),
        opening,
    });
}

/// Capitalised phrases, plus any all-caps token inside one.
fn harvest_guessed(doc: &Prepared) -> Vec<Harvested> {
    let mut out = Vec::new();
    let mut seen = HashMap::new();
    // Byte and UTF-16 cursor so each match's offset is found without rescanning.
    let mut cursor_byte = 0usize;
    let mut cursor_units = 0usize;
    for caps in candidate_re().captures_iter(&doc.plain) {
        let Some(phrase) = caps.get(1) else {
            continue;
        };
        cursor_units += utf16_len(&doc.plain[cursor_byte..phrase.start()]);
        cursor_byte = phrase.start();
        let index = cursor_units;
        let length = utf16_len(phrase.as_str());
        record_guessed(doc, &mut out, &mut seen, phrase.as_str(), index, length);
        for (token, at) in token_offsets(phrase.as_str()) {
            let stem = token.strip_suffix('s').unwrap_or(&token);
            if !is_acronym(stem) {
                continue;
            }
            record_guessed(doc, &mut out, &mut seen, &token, index + at, token.len());
        }
    }
    out
}

/// The stated signal wins the kind only when the other side is not recognised.
fn prefer_kind(current: &Entry, incoming: &Harvested) -> &'static str {
    if current.kind == incoming.kind {
        return current.kind;
    }
    if current.kind_recognised != incoming.kind_recognised {
        return if current.kind_recognised {
            current.kind
        } else {
            incoming.kind
        };
    }
    let theirs = informativeness(incoming.kind);
    let ours = informativeness(current.kind);
    if theirs != ours {
        return if theirs > ours {
            incoming.kind
        } else {
            current.kind
        };
    }
    if incoming.strength == Strength::Stated {
        incoming.kind
    } else {
        current.kind
    }
}

/// Merges mentions into concepts in first-seen order.
fn merge_mentions(mentions: &[Harvested]) -> Vec<Entry> {
    let mut entries: Vec<Entry> = Vec::new();
    let mut position: HashMap<String, usize> = HashMap::new();
    for mention in mentions {
        let Some(&pos) = position.get(&mention.key) else {
            let _ = position.insert(mention.key.clone(), entries.len());
            entries.push(Entry {
                key: mention.key.clone(),
                name: mention.name.clone(),
                kind: mention.kind,
                kind_recognised: mention.kind_recognised,
                strength: mention.strength,
                documents: HashSet::from([mention.document_id.clone()]),
                named: !mention.opening,
            });
            continue;
        };
        let existing = &mut entries[pos];
        let _ = existing.documents.insert(mention.document_id.clone());
        if !mention.opening {
            existing.named = true;
        }
        if mention.strength == Strength::Stated && existing.strength == Strength::Guessed {
            existing.name = mention.name.clone();
            existing.strength = Strength::Stated;
        }
        let kind = prefer_kind(existing, mention);
        existing.kind_recognised = existing.kind_recognised || mention.kind_recognised;
        existing.kind = kind;
    }
    entries
}

/// Compares by UTF-16 code units, as JS `<` does.
fn js_string_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    a.encode_utf16().cmp(b.encode_utf16())
}

/// Named concepts seen in enough documents, most documents first, then by name.
fn rank_and_limit(entries: Vec<Entry>, max_concepts: Option<f64>) -> Vec<Entry> {
    let mut ranked: Vec<Entry> = entries
        .into_iter()
        .filter(|entry| entry.named)
        .filter(|entry| entry.documents.len() >= MIN_MENTIONS || entry.strength == Strength::Stated)
        .collect();
    ranked.sort_by(|a, b| {
        b.documents
            .len()
            .cmp(&a.documents.len())
            .then_with(|| js_string_cmp(&a.name, &b.name))
    });
    if let Some(keep) = js_slice_keep(ranked.len(), max_concepts) {
        ranked.truncate(keep);
    }
    ranked
}

/// The mentions of the kept concepts, with their documents and evidence.
fn project_mentions(mentions: &[Harvested], kept: &[Entry]) -> Vec<ExtractedMention> {
    let keys: HashSet<&str> = kept.iter().map(|entry| entry.key.as_str()).collect();
    mentions
        .iter()
        .filter(|mention| keys.contains(mention.key.as_str()))
        .map(|mention| ExtractedMention {
            document_id: mention.document_id.clone(),
            concept_name: mention.name.clone(),
            evidence: mention.evidence.clone(),
        })
        .collect()
}

/// Extracts concepts from documents by capitalisation, hashtags and wikilinks.
/// No model is needed, so this runs anywhere.
#[must_use]
pub fn extract_lexical(request: &LexicalRequest) -> ExtractionResult {
    let mentions: Vec<Harvested> = request
        .documents
        .iter()
        .flat_map(|source| {
            let doc = prepare(source);
            let mut out = harvest_stated(&doc);
            out.extend(harvest_guessed(&doc));
            out
        })
        .collect();

    let merged = merge_mentions(&mentions);
    let limited = rank_and_limit(merged, request.max_concepts);

    ExtractionResult {
        concepts: limited
            .iter()
            .map(|entry| ExtractedConcept {
                name: entry.name.clone(),
                aliases: Vec::new(),
                kind: entry.kind.to_string(),
                mentions: entry.documents.len() as f64,
            })
            .collect(),
        mentions: project_mentions(&mentions, &limited),
        pending: None,
    }
}

// Patterns are compiled once. They are literals, so a failure is a programming error.

#[allow(clippy::expect_used, reason = "static regex literal, always valid")]
fn candidate_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        let pattern = format!(
            r"\b([A-Z][\w-]*(?:[{sp}]+[A-Z][\w-]*){{0,3}})\b",
            sp = space_class()
        );
        compile(&pattern).expect("candidate pattern")
    })
}

#[allow(clippy::expect_used, reason = "static regex literal, always valid")]
fn plain_word_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| compile(r"^[A-Z][a-z]*(?:-[a-z]+)*$").expect("plain word pattern"))
}

#[allow(clippy::expect_used, reason = "static regex literal, always valid")]
fn fence_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| compile(r"```[\s\S]*?```").expect("fence pattern"))
}

#[allow(clippy::expect_used, reason = "static regex literal, always valid")]
fn code_span_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| compile(r"`[^`\n]*`").expect("code span pattern"))
}

#[allow(clippy::expect_used, reason = "static regex literal, always valid")]
fn image_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| compile(r"!\[[^\]]*\]\([^)]*\)").expect("image pattern"))
}

#[allow(clippy::expect_used, reason = "static regex literal, always valid")]
fn bracket_link_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| compile(r"\[\[([^\]]*)\]\]").expect("bracket link pattern"))
}

#[allow(clippy::expect_used, reason = "static regex literal, always valid")]
fn heading_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| compile(r"(?m)^#{1,6}\s+").expect("heading pattern"))
}

#[allow(clippy::expect_used, reason = "static regex literal, always valid")]
fn wikilink_blank_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| compile(r"\[\[[^\[\]\n]*\]\]").expect("wikilink pattern"))
}

#[allow(clippy::expect_used, reason = "static regex literal, always valid")]
fn dataset_keyword_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| compile(r"(?i)\b(dataset|corpus|benchmark)\b").expect("dataset pattern"))
}

#[allow(clippy::expect_used, reason = "static regex literal, always valid")]
fn metric_keyword_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        compile(r"(?i)\b(accuracy|f1|bleu|loss|score|rate)\b").expect("metric pattern")
    })
}

#[allow(clippy::expect_used, reason = "static regex literal, always valid")]
fn venue_keyword_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        compile(r"(?i)\b(conference|workshop|journal|proceedings)\b").expect("venue pattern")
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn doc(id: &str, text: &str) -> LexicalDocument {
        LexicalDocument {
            id: id.to_string(),
            text: Some(text.to_string()),
        }
    }

    fn run(documents: Vec<LexicalDocument>) -> ExtractionResult {
        extract_lexical(&LexicalRequest {
            documents,
            max_concepts: None,
        })
    }

    fn names(result: &ExtractionResult) -> Vec<String> {
        result.concepts.iter().map(|c| c.name.clone()).collect()
    }

    fn keys(result: &ExtractionResult) -> Vec<String> {
        result
            .concepts
            .iter()
            .map(|c| concept_key(&c.name))
            .collect()
    }

    fn kind_of(result: &ExtractionResult, key: &str) -> Option<String> {
        result
            .concepts
            .iter()
            .find(|c| concept_key(&c.name) == key)
            .map(|c| c.kind.clone())
    }

    #[test]
    fn hashtags_and_wikilinks_are_always_kept() {
        let result = run(vec![doc(
            "n1",
            "Working on #vae and [[Graph Neural Networks]].",
        )]);
        let found = keys(&result);
        assert!(
            found.iter().any(|k| k == "vae"),
            "a single hashtag still counts"
        );
        assert!(found.iter().any(|k| k == "graph neural networks"));
    }

    #[test]
    fn capitalised_phrase_in_one_document_is_incidental() {
        let once = run(vec![doc("n1", "We used Adam here.")]);
        assert!(!names(&once).iter().any(|n| n == "Adam"));

        let twice = run(vec![
            doc("n1", "We used Adam here."),
            doc("n2", "Adam again."),
        ]);
        assert!(names(&twice).iter().any(|n| n == "Adam"));
    }

    #[test]
    fn sentence_openings_are_not_mistaken_for_names() {
        let text = "The results improved. However the baseline held. Therefore we stopped.";
        let result = run(vec![doc("n1", text), doc("n2", text)]);
        let lowered: Vec<String> = names(&result).iter().map(|n| n.to_lowercase()).collect();
        for stop in ["the", "however", "therefore"] {
            assert!(
                !lowered.iter().any(|n| n == stop),
                "{stop:?} should not be a concept"
            );
        }
    }

    #[test]
    fn lone_word_at_line_or_sentence_starts_is_not_a_concept() {
        let text = [
            "## Background",
            "Used the encoder twice. Not stable yet.",
            "- Only the first run.",
            "Cite: (Graph) papers. Related work below.",
        ]
        .join("\n");
        let result = run(vec![doc("n1", &text), doc("n2", &text)]);
        let lowered: Vec<String> = names(&result).iter().map(|n| n.to_lowercase()).collect();
        for stop in [
            "background",
            "used",
            "not",
            "only",
            "cite",
            "graph",
            "related",
        ] {
            assert!(
                !lowered.iter().any(|n| n == stop),
                "{stop:?} should not be a concept"
            );
        }
    }

    #[test]
    fn word_opening_bold_text_or_table_cell_is_not_a_concept() {
        let text = [
            "**Why:** the prior helps.",
            "| Symbol | Meaning |",
            "|---|---|",
            "| x | Input |",
        ]
        .join("\n");
        let result = run(vec![doc("n1", &text), doc("n2", &text)]);
        let lowered: Vec<String> = names(&result).iter().map(|n| n.to_lowercase()).collect();
        for stop in ["why", "symbol", "meaning", "input"] {
            assert!(
                !lowered.iter().any(|n| n == stop),
                "{stop:?} should not be a concept"
            );
        }
    }

    #[test]
    fn acronym_plural_is_the_same_concept() {
        let result = run(vec![
            doc("n1", "We train a VAE here."),
            doc("n2", "Two VAEs compared."),
        ]);
        let found = names(&result);
        assert!(found.iter().any(|n| n == "VAE"), "{found:?}");
        assert!(!found.iter().any(|n| n == "VAEs"), "{found:?}");
        let vae = result
            .concepts
            .iter()
            .find(|c| c.name == "VAE")
            .expect("VAE concept");
        assert_eq!(vae.mentions, 2.0);
    }

    #[test]
    fn lone_word_also_used_mid_sentence_is_still_a_name() {
        let result = run(vec![
            doc("n1", "Adam converged. We compare GAN to ImageNet."),
            doc("n2", "We tried Adam again.\nGAN works. ImageNet helps."),
        ]);
        let found = names(&result);
        for name in ["Adam", "GAN", "ImageNet"] {
            assert!(found.iter().any(|n| n == name), "{name} kept");
        }
    }

    #[test]
    fn code_blocks_and_image_markup_are_not_mined() {
        let result = run(vec![
            doc(
                "n1",
                "```\nconst Foo = new Bar();\n```\n![](vault:u/n/Baz.png)",
            ),
            doc("n2", "```\nconst Foo = new Bar();\n```"),
        ]);
        assert!(
            !names(&result)
                .iter()
                .any(|n| matches!(n.as_str(), "Foo" | "Bar" | "Baz"))
        );
    }

    #[test]
    fn acronyms_are_picked_up_and_classified_as_methods() {
        let result = run(vec![
            doc("n1", "We compare GAN results."),
            doc("n2", "GAN again."),
        ]);
        let gan = result
            .concepts
            .iter()
            .find(|c| c.name == "GAN")
            .expect("GAN concept");
        assert_eq!(gan.kind, "method");
    }

    #[test]
    fn mentions_carry_evidence_for_the_review_queue() {
        let result = run(vec![doc(
            "n1",
            "The encoder uses #vae tricks throughout the pipeline.",
        )]);
        let mention = result
            .mentions
            .iter()
            .find(|m| concept_key(&m.concept_name) == "vae")
            .expect("vae mention");
        assert!(!mention.evidence.is_empty());
    }

    #[test]
    fn extraction_needs_no_model_and_no_configuration() {
        // The `id` of the extractor is checked on the TS shim.
        assert_eq!(run(Vec::new()), ExtractionResult::default());
    }

    #[test]
    fn max_concepts_caps_the_result_and_prunes_orphaned_mentions() {
        let text = "AlphaOne BetaTwo GammaThree DeltaFour";
        let result = extract_lexical(&LexicalRequest {
            documents: vec![doc("n1", text), doc("n2", text)],
            max_concepts: Some(2.0),
        });
        assert!(result.concepts.len() <= 2);
        let kept: HashSet<String> = keys(&result).into_iter().collect();
        assert!(
            result
                .mentions
                .iter()
                .all(|m| kept.contains(&concept_key(&m.concept_name)))
        );
    }

    #[test]
    fn max_concepts_follows_js_slice_for_odd_values() {
        let text = "AlphaOne BetaTwo GammaThree DeltaFour";
        let run_with = |max: Option<f64>| {
            extract_lexical(&LexicalRequest {
                documents: vec![doc("n1", text), doc("n2", text)],
                max_concepts: max,
            })
            .concepts
            .len()
        };
        let uncapped = run_with(None);
        assert!(uncapped >= 3);
        // NaN and zero are falsy in JS, so they cap nothing.
        assert_eq!(run_with(Some(f64::NAN)), uncapped);
        assert_eq!(run_with(Some(0.0)), uncapped);
        // Fractions truncate, negatives count from the end, Infinity keeps all.
        assert_eq!(run_with(Some(1.9)), 1);
        assert_eq!(run_with(Some(-1.0)), uncapped - 1);
        assert_eq!(run_with(Some(f64::INFINITY)), uncapped);
        assert_eq!(run_with(Some(-1000.0)), 0);
    }

    #[test]
    fn acronyms_we_know_are_not_all_filed_as_methods() {
        let result = run(vec![
            doc(
                "n1",
                "Submitted to ICLR. The MNIST split. We report BLEU. Off to NEURIPS.",
            ),
            doc("n2", "ICLR again, MNIST again, BLEU again, NEURIPS again."),
        ]);
        assert_eq!(kind_of(&result, "iclr").as_deref(), Some("venue"));
        assert_eq!(kind_of(&result, "neurips").as_deref(), Some("venue"));
        assert_eq!(kind_of(&result, "mnist").as_deref(), Some("dataset"));
        assert_eq!(kind_of(&result, "bleu").as_deref(), Some("metric"));
    }

    #[test]
    fn stated_link_is_classified_too_not_filed_as_a_bare_concept() {
        let result = run(vec![doc(
            "n1",
            "Trained on [[ImageNet]] and tagged #iclr for the deadline.",
        )]);
        assert_eq!(kind_of(&result, "imagenet").as_deref(), Some("dataset"));
        assert_eq!(kind_of(&result, "iclr").as_deref(), Some("venue"));
    }

    #[test]
    fn ordinary_lowercase_tag_is_not_mistaken_for_an_acronym() {
        let result = run(vec![doc("n1", "Some #notes and #todo for later.")]);
        assert_eq!(kind_of(&result, "notes").as_deref(), Some("concept"));
        assert_eq!(kind_of(&result, "todo").as_deref(), Some("concept"));
    }

    #[test]
    fn wikilink_with_no_target_names_nothing() {
        let result = run(vec![doc("n1", "Jump to [[#Overview]] and to [[|alias]].")]);
        assert!(result.concepts.is_empty());
        assert!(
            !result
                .mentions
                .iter()
                .any(|m| concept_key(&m.concept_name).is_empty())
        );
    }

    #[test]
    fn concept_named_only_by_a_wikilink_still_carries_evidence() {
        let result = run(vec![doc(
            "n1",
            "See [[Graph Neural Networks]] for the details.",
        )]);
        let mention = result
            .mentions
            .iter()
            .find(|m| concept_key(&m.concept_name) == "graph neural networks")
            .expect("graph neural networks mention");
        assert!(
            !mention.evidence.is_empty(),
            "a stated concept must not arrive with empty evidence"
        );
        assert!(
            mention.evidence.contains("Graph Neural Networks"),
            "{}",
            mention.evidence
        );
    }

    #[test]
    fn one_scan_still_finds_the_acronym_inside_a_hyphenated_phrase() {
        let text = "VAE-based models are cheaper.";
        let result = run(vec![doc("n1", text), doc("n2", text)]);
        let found = keys(&result);
        assert!(
            found.iter().any(|k| k == "vae"),
            "expected the acronym; got {found:?}"
        );
        assert!(
            found.iter().any(|k| k == "vae-based"),
            "and the phrase it sits in"
        );
    }

    #[test]
    fn acronym_evidence_points_at_the_acronym_not_an_earlier_word_containing_it() {
        let text = "The MAGAN GAN Models baseline is the comparison we report.";
        let result = run(vec![doc("n1", text), doc("n2", text)]);
        assert!(
            result.concepts.iter().any(|c| c.name == "GAN"),
            "the standalone acronym is still found"
        );
        let mention = result
            .mentions
            .iter()
            .find(|m| m.concept_name == "GAN")
            .expect("GAN mention");
        assert!(
            mention.evidence.contains("GAN Models"),
            "{}",
            mention.evidence
        );
        assert!(!mention.evidence.ends_with("MAGAN"), "{}", mention.evidence);
    }

    #[test]
    fn stated_tag_corrects_the_name_a_guess_froze_first() {
        let result = run(vec![
            doc("n1", "Our Transformer baseline."),
            doc("n2", "Transformer again."),
            doc("n3", "Tagged as #transformer in the plan."),
        ]);
        let concept = result
            .concepts
            .iter()
            .find(|c| concept_key(&c.name) == "transformer")
            .expect("transformer concept");
        assert_eq!(
            concept.name, "transformer",
            "the tag's own spelling is the one kept"
        );
    }

    #[test]
    fn stated_tag_cannot_downgrade_a_kind_a_rule_recognised() {
        let result = run(vec![
            doc("n1", "We use ABC here."),
            doc("n2", "ABC again."),
            doc("n3", "Tagged #abc too."),
        ]);
        let concept = result
            .concepts
            .iter()
            .find(|c| concept_key(&c.name) == "abc")
            .expect("abc concept");
        assert_eq!(concept.kind, "method");
    }
}
