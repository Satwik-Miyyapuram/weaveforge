//! Port of packages/core/src/features/ai-assistant/domain/wiki-merge.ts. Pure.

use std::collections::HashSet;

use crate::reader_analysis::lines::{is_js_space, js_trim, js_trim_end};

/// Similar wording but opposite polarity: the signature of a contradiction.
const CONTRADICTION_SIMILARITY: f64 = 0.6;
/// Near-identical statements are the same claim written twice.
const DUPLICATE_SIMILARITY: f64 = 0.85;

/// The words that flip a statement's meaning (TS `NEGATIONS`, ASCII case-insensitive).
const NEGATION_WORDS: &[&str] = &[
    "not",
    "no",
    "never",
    "cannot",
    "can't",
    "doesn't",
    "does not",
    "isn't",
    "is not",
    "without",
    "fail",
    "fails",
    "worse",
    "lower",
    "decrease",
    "decreases",
];

/// A contradicting pair and the statements to add, as the merge builds them.
type Classified = (Vec<Contradiction>, Vec<String>);

/// A page as the merge reads it (TS `MergeInput`).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct MergeInput {
    /// Page id; the merge does not read it.
    pub id: String,
    /// The page title; the primary title is kept.
    pub title: String,
    /// The page body as markdown.
    pub body: String,
    /// Other names the page answers to.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub aliases: Option<Vec<String>>,
    /// Source references for the page.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub sources: Option<Vec<String>>,
}

/// A statement the two pages disagree on, kept from both sides (TS `Contradiction`).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct Contradiction {
    /// The statement from the page being kept.
    pub from_primary: String,
    /// The conflicting statement from the page being merged in.
    pub from_secondary: String,
}

/// The merged page (TS `WikiMergeResult`).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct WikiMergeResult {
    /// The primary page's title.
    pub title: String,
    /// The merged markdown body.
    pub body: String,
    /// Aliases of both pages, plus the absorbed title.
    pub aliases: Vec<String>,
    /// Sources of both pages, de-duplicated.
    pub sources: Vec<String>,
    /// Statements that disagree, kept side by side.
    pub contradictions: Vec<Contradiction>,
}

/// `s` with a leading `---` front matter block removed, as TS `^---[\s\S]*?---`.
fn strip_front_matter(body: &str) -> &str {
    let Some(rest) = body.strip_prefix("---") else {
        return body;
    };
    match rest.find("---") {
        Some(end) => &rest[end + 3..],
        None => body,
    }
}

/// Index just past the run of chars from `from` that satisfy `pred`.
fn run_end(chars: &[(usize, char)], from: usize, pred: fn(char) -> bool) -> usize {
    chars[from..]
        .iter()
        .position(|&(_, c)| !pred(c))
        .map_or(chars.len(), |offset| from + offset)
}

/// End index of the separator that starts at `k`, if one does: a blank-line run, or
/// whitespace after `.`/`!`/`?` before an `A`-`Z` letter.
fn separator_end(chars: &[(usize, char)], k: usize) -> Option<usize> {
    let c = chars[k].1;
    if c == '\n' && chars.get(k + 1).is_some_and(|&(_, next)| next == '\n') {
        return Some(run_end(chars, k, |n| n == '\n'));
    }
    let after_sentence = k > 0 && matches!(chars[k - 1].1, '.' | '!' | '?');
    if !after_sentence || !is_js_space(c) {
        return None;
    }
    let end = run_end(chars, k, is_js_space);
    chars
        .get(end)
        .is_some_and(|&(_, next)| next.is_ascii_uppercase())
        .then_some(end)
}

/// `body.split(/\n{2,}|(?<=[.!?])\s+(?=[A-Z])/)`.
fn split_statements(text: &str) -> Vec<&str> {
    let chars: Vec<(usize, char)> = text.char_indices().collect();
    let mut pieces = Vec::new();
    let mut start = 0;
    let mut k = 0;
    while k < chars.len() {
        match separator_end(&chars, k) {
            Some(end) => {
                pieces.push(&text[start..chars[k].0]);
                start = chars.get(end).map_or(text.len(), |&(at, _)| at);
                k = end;
            }
            None => k += 1,
        }
    }
    pieces.push(&text[start..]);
    pieces
}

/// `/^#{1,6}\s/` on a trimmed line.
fn is_heading(line: &str) -> bool {
    let hashes = line.chars().take_while(|&c| c == '#').count();
    (1..=6).contains(&hashes) && line[hashes..].chars().next().is_some_and(is_js_space)
}

/// Split prose into comparable statements (TS `statements`).
fn statements(body: &str) -> Vec<String> {
    split_statements(strip_front_matter(body))
        .into_iter()
        .map(js_trim)
        .filter(|line| !line.is_empty() && !is_heading(line) && !line.starts_with('>'))
        .map(str::to_owned)
        .collect()
}

/// `conceptKey`: trimmed, lower-cased, inner whitespace runs collapsed to one space.
fn concept_key(name: &str) -> String {
    js_trim(name)
        .to_lowercase()
        .split(is_js_space)
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

fn is_word_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_'
}

/// Whether `word` matches at `at` (ASCII, case-insensitive) and ends on a word boundary.
fn word_matches_at(chars: &[char], at: usize, word: &str) -> bool {
    let len = word.len();
    let Some(slice) = chars.get(at..at + len) else {
        return false;
    };
    let matched = slice
        .iter()
        .zip(word.chars())
        .all(|(a, b)| a.eq_ignore_ascii_case(&b));
    matched && !chars.get(at + len).is_some_and(|&c| is_word_char(c))
}

/// `NEGATIONS.test(text)`: a negation word on word boundaries, any case.
fn has_negation(text: &str) -> bool {
    let chars: Vec<char> = text.chars().collect();
    (0..chars.len()).any(|at| {
        let starts_word = at == 0 || !is_word_char(chars[at - 1]);
        starts_word
            && NEGATION_WORDS
                .iter()
                .any(|word| word_matches_at(&chars, at, word))
    })
}

/// Words longer than three UTF-16 units from the concept key, as a set.
fn content_words(value: &str) -> HashSet<String> {
    concept_key(value)
        .split(' ')
        .filter(|word| word.encode_utf16().count() > 3)
        .map(str::to_owned)
        .collect()
}

/// Shared content words over the larger word set, 0 when either is empty.
#[allow(
    clippy::cast_precision_loss,
    reason = "word counts stay far below 2^52"
)]
fn similarity(a: &str, b: &str) -> f64 {
    let first = content_words(a);
    let second = content_words(b);
    if first.is_empty() || second.is_empty() {
        return 0.0;
    }
    let shared = first.iter().filter(|word| second.contains(*word)).count();
    shared as f64 / first.len().max(second.len()) as f64
}

fn contradicts(a: &str, b: &str) -> bool {
    similarity(a, b) >= CONTRADICTION_SIMILARITY && has_negation(a) != has_negation(b)
}

/// Order-preserving de-duplication, as `[...new Set(items)]`.
fn unique(items: impl IntoIterator<Item = String>) -> Vec<String> {
    let mut seen = HashSet::new();
    items
        .into_iter()
        .filter(|item| seen.insert(item.clone()))
        .collect()
}

/// Sorts the secondary statements into contradictions and additions.
fn classify(primary: &[String], secondary: &[String]) -> Classified {
    let mut contradictions = Vec::new();
    let mut additions = Vec::new();
    for candidate in secondary {
        if let Some(conflict) = primary
            .iter()
            .find(|existing| contradicts(existing, candidate))
        {
            contradictions.push(Contradiction {
                from_primary: conflict.clone(),
                from_secondary: candidate.clone(),
            });
            continue;
        }
        let duplicate = primary
            .iter()
            .any(|existing| similarity(existing, candidate) >= DUPLICATE_SIMILARITY);
        if !duplicate {
            additions.push(candidate.clone());
        }
    }
    (contradictions, additions)
}

fn render_body(
    primary: &MergeInput,
    secondary: &MergeInput,
    additions: &[String],
    contradictions: &[Contradiction],
) -> String {
    let mut body = vec![js_trim_end(&primary.body).to_owned()];
    if !additions.is_empty() {
        body.push(String::new());
        body.push(format!("## From {}", secondary.title));
        body.push(String::new());
        body.extend(additions.iter().cloned());
    }
    if !contradictions.is_empty() {
        body.push(String::new());
        body.push("## Conflicting notes".to_owned());
        body.push(String::new());
        body.push(
            "> These statements disagree. Both are kept until someone decides which is right."
                .to_owned(),
        );
        body.push(String::new());
        for conflict in contradictions {
            body.push(format!(
                "- **{}:** {}",
                primary.title, conflict.from_primary
            ));
            body.push(format!(
                "- **{}:** {}",
                secondary.title, conflict.from_secondary
            ));
            body.push(String::new());
        }
    }
    js_trim_end(&body.join("\n")).to_owned()
}

/// Aliases of both pages plus the absorbed title, minus anything that names the primary.
fn merged_aliases(primary: &MergeInput, secondary: &MergeInput) -> Vec<String> {
    let primary_key = concept_key(&primary.title);
    unique(
        primary
            .aliases
            .iter()
            .flatten()
            .chain(secondary.aliases.iter().flatten())
            .cloned()
            .chain(std::iter::once(secondary.title.clone())),
    )
    .into_iter()
    .filter(|alias| concept_key(alias) != primary_key)
    .collect()
}

/// Merge `secondary` into `primary`. `primary` keeps its title; the other title becomes an
/// alias, so links to either continue to resolve after the merge.
#[must_use]
pub fn merge_wiki_pages(primary: &MergeInput, secondary: &MergeInput) -> WikiMergeResult {
    let (contradictions, additions) =
        classify(&statements(&primary.body), &statements(&secondary.body));
    WikiMergeResult {
        title: primary.title.clone(),
        body: render_body(primary, secondary, &additions, &contradictions),
        aliases: merged_aliases(primary, secondary),
        sources: unique(
            primary
                .sources
                .iter()
                .flatten()
                .chain(secondary.sources.iter().flatten())
                .cloned(),
        ),
        contradictions,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn page(title: &str, body: &str) -> MergeInput {
        MergeInput {
            id: title.to_owned(),
            title: title.to_owned(),
            body: body.to_owned(),
            aliases: None,
            sources: None,
        }
    }

    #[test]
    fn opposing_statements_are_kept_side_by_side() {
        let primary = page("Caching", "The model is faster with caching.");
        let secondary = page("Cache Notes", "The model is not faster with caching.");
        let merged = merge_wiki_pages(&primary, &secondary);
        assert_eq!(merged.contradictions.len(), 1);
        assert_eq!(
            merged.contradictions[0].from_secondary,
            "The model is not faster with caching."
        );
        assert!(merged.body.contains("## Conflicting notes"));
        assert!(!merged.body.contains("## From"));
    }

    #[test]
    fn near_duplicates_are_skipped_and_new_statements_added() {
        let primary = page("Batch", "Batch size matters for throughput.");
        let secondary = page(
            "Other",
            "Batch size matters for throughput. Warmup is cheap.",
        );
        let merged = merge_wiki_pages(&primary, &secondary);
        assert_eq!(merged.body.matches("Batch size").count(), 1);
        assert!(merged.body.contains("## From Other"));
        assert!(merged.body.ends_with("Warmup is cheap."));
        assert!(merged.contradictions.is_empty());
    }

    #[test]
    fn front_matter_headings_and_quotes_are_not_statements() {
        let primary = page("A", "");
        let secondary = page(
            "B",
            "---\ntags: x\n---\n# Heading\n\n> quoted\n\nKept line.",
        );
        let merged = merge_wiki_pages(&primary, &secondary);
        assert!(merged.body.contains("Kept line."));
        assert!(!merged.body.contains("Heading"));
        assert!(!merged.body.contains("quoted"));
        assert!(!merged.body.contains("tags"));
    }

    #[test]
    fn absorbed_title_is_an_alias_unless_it_names_the_primary() {
        let mut primary = page("Alpha", "");
        primary.aliases = Some(vec!["Cache".to_owned()]);
        let mut secondary = page("alpha", "");
        secondary.aliases = Some(vec!["Beta".to_owned()]);
        let merged = merge_wiki_pages(&primary, &secondary);
        assert_eq!(merged.aliases, vec!["Cache", "Beta"]);
    }

    #[test]
    fn sentence_and_paragraph_breaks_split_statements() {
        assert_eq!(
            split_statements("Alpha is here. Beta is there.\n\nGamma"),
            vec!["Alpha is here.", "Beta is there.", "Gamma"]
        );
        assert!(has_negation("It does NOT help."));
        assert!(!has_negation("notable gain"));
    }
}
