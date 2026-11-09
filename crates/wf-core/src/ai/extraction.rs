//! Folding concept extractions together (TS ai-extraction.ts `conceptKey`,
//! `mergeExtractions`, `withoutExisting`).

use std::collections::{HashMap, HashSet};

use crate::js_collate::locale_compare;
use crate::search::js_text::is_js_whitespace;

/// One concept a run found (TS `ExtractedConcept`). `kind` stays text so any value passes through.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ExtractedConcept {
    /// Display name.
    pub name: String,
    /// Other names for the same concept.
    #[serde(default)]
    pub aliases: Vec<String>,
    /// `concept`, `method`, `dataset`, `metric`, `person` or `venue`.
    pub kind: String,
    /// How many documents mention it.
    pub mentions: f64,
}

/// Where a concept was found (TS `ExtractedMention`).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ExtractedMention {
    /// The document it was found in.
    pub document_id: String,
    /// The concept's name as found.
    pub concept_name: String,
    /// Verbatim text around it.
    pub evidence: String,
}

/// A run's concepts and mentions (TS `ExtractionResult`).
#[derive(Debug, Clone, PartialEq, Default, serde::Serialize, serde::Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ExtractionResult {
    /// The concepts.
    #[serde(default)]
    pub concepts: Vec<ExtractedConcept>,
    /// The mentions.
    #[serde(default)]
    pub mentions: Vec<ExtractedMention>,
    /// Set when the work was handed to something that answers later.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub pending: Option<bool>,
}

/// Normalized key for comparing concept names: trimmed, lowercased, runs of whitespace as one space.
#[must_use]
pub fn concept_key(name: &str) -> String {
    let lower = name.trim_matches(is_js_whitespace).to_lowercase();
    let mut out = String::with_capacity(lower.len());
    let mut in_space = false;
    for ch in lower.chars() {
        if is_js_whitespace(ch) {
            if !in_space {
                out.push(' ');
            }
            in_space = true;
        } else {
            out.push(ch);
            in_space = false;
        }
    }
    out
}

/// Merge results: mention counts summed, aliases unioned, mentions deduped per document and concept.
/// Concepts come back most-mentioned first, then by name.
#[must_use]
pub fn merge_extractions(results: &[ExtractionResult]) -> ExtractionResult {
    let mut concepts: Vec<ExtractedConcept> = Vec::new();
    let mut index: HashMap<String, usize> = HashMap::new();
    let mut mentions = Vec::new();
    let mut seen = HashSet::new();
    let mut pending = false;

    for result in results {
        if result.pending == Some(true) {
            pending = true;
        }
        for concept in &result.concepts {
            let key = concept_key(&concept.name);
            if let Some(&at) = index.get(&key) {
                let existing = &mut concepts[at];
                existing.mentions += concept.mentions;
                let aliases = existing.aliases.iter().chain(&concept.aliases);
                existing.aliases = unique(aliases);
            } else {
                let _ = index.insert(key, concepts.len());
                concepts.push(concept.clone());
            }
        }
        for mention in &result.mentions {
            let key = format!(
                "{}|{}",
                mention.document_id,
                concept_key(&mention.concept_name)
            );
            if seen.insert(key) {
                mentions.push(mention.clone());
            }
        }
    }

    concepts.sort_by(|a, b| {
        b.mentions
            .partial_cmp(&a.mentions)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| locale_compare(&a.name, &b.name))
    });
    ExtractionResult {
        concepts,
        mentions,
        pending: pending.then_some(true),
    }
}

/// Drop concepts whose name or any alias is already in the wiki, and their mentions.
#[must_use]
pub fn without_existing(result: &ExtractionResult, existing: &[String]) -> ExtractionResult {
    let known: HashSet<String> = existing.iter().map(|name| concept_key(name)).collect();
    let concepts: Vec<ExtractedConcept> = result
        .concepts
        .iter()
        .filter(|c| {
            !known.contains(&concept_key(&c.name))
                && !c.aliases.iter().any(|a| known.contains(&concept_key(a)))
        })
        .cloned()
        .collect();
    let kept: HashSet<String> = concepts.iter().map(|c| concept_key(&c.name)).collect();
    ExtractionResult {
        mentions: result
            .mentions
            .iter()
            .filter(|m| kept.contains(&concept_key(&m.concept_name)))
            .cloned()
            .collect(),
        concepts,
        pending: result.pending,
    }
}

/// First occurrence of each value, in order (JS `[...new Set(values)]`).
fn unique<'a>(values: impl Iterator<Item = &'a String>) -> Vec<String> {
    let mut seen = HashSet::new();
    values
        .filter(|v| seen.insert(v.as_str()))
        .cloned()
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn concept(name: &str, aliases: &[&str], mentions: f64) -> ExtractedConcept {
        ExtractedConcept {
            name: name.into(),
            aliases: aliases.iter().map(|a| (*a).to_owned()).collect(),
            kind: "concept".into(),
            mentions,
        }
    }

    fn mention(doc: &str, name: &str) -> ExtractedMention {
        ExtractedMention {
            document_id: doc.into(),
            concept_name: name.into(),
            evidence: "e".into(),
        }
    }

    #[test]
    fn concept_key_trims_lowercases_and_collapses_space() {
        assert_eq!(
            concept_key("  Graph \t Neural\nNets\u{a0}"),
            "graph neural nets"
        );
        assert_eq!(concept_key(""), "");
    }

    #[test]
    fn merge_sums_unions_dedupes_and_sorts() {
        let a = ExtractionResult {
            concepts: vec![
                concept("VAE", &["vae", "x"], 1.0),
                concept("Beta", &[], 2.0),
            ],
            mentions: vec![mention("d1", "VAE"), mention("d1", " vae ")],
            pending: None,
        };
        let b = ExtractionResult {
            concepts: vec![concept("vae", &["x", "y"], 2.0)],
            mentions: vec![mention("d2", "vae")],
            pending: Some(true),
        };
        let merged = merge_extractions(&[a, b]);
        assert_eq!(merged.concepts[0].name, "VAE");
        assert!((merged.concepts[0].mentions - 3.0).abs() < f64::EPSILON);
        assert_eq!(merged.concepts[0].aliases, ["vae", "x", "y"]);
        assert_eq!(merged.concepts[1].name, "Beta");
        assert_eq!(merged.mentions.len(), 2);
        assert_eq!(merged.pending, Some(true));
    }

    #[test]
    fn merge_ties_sort_by_name_and_omit_pending() {
        let a = ExtractionResult {
            concepts: vec![concept("b", &[], 1.0), concept("A", &[], 1.0)],
            ..ExtractionResult::default()
        };
        let merged = merge_extractions(&[
            a,
            ExtractionResult {
                pending: Some(false),
                ..Default::default()
            },
        ]);
        let names: Vec<_> = merged.concepts.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(names, ["A", "b"]);
        assert_eq!(merged.pending, None);
    }

    #[test]
    fn without_existing_drops_by_name_or_alias_with_mentions() {
        let result = ExtractionResult {
            concepts: vec![
                concept("VAE", &[], 1.0),
                concept("GAN", &["Adversarial Net"], 1.0),
                concept("RNN", &[], 1.0),
            ],
            mentions: vec![
                mention("d", "vae"),
                mention("d", "GAN"),
                mention("d", "rnn"),
            ],
            pending: Some(false),
        };
        let pruned = without_existing(&result, &["  vae".into(), "adversarial   net".into()]);
        assert_eq!(pruned.concepts.len(), 1);
        assert_eq!(pruned.concepts[0].name, "RNN");
        assert_eq!(pruned.mentions, vec![mention("d", "rnn")]);
        assert_eq!(pruned.pending, Some(false));
    }
}
