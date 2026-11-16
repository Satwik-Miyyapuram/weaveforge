//! Folding of search hits onto their entities, and de-duplication of related
//! lists (TS `collapse-to-entities.ts`).
//!
//! The web side resolves each hit's entity document and each entry's
//! `kind`/`entityId`/`title` before calling in, so no callbacks cross the
//! wasm boundary. Indices returned by [`distinct_related`] refer to the
//! `entries` input.

use std::collections::HashMap;

use crate::search::js_text::{is_js_whitespace, is_letter_or_number, utf16_len};

/// Shortest shared title prefix, in UTF-16 units, that makes two titles
/// truncated copies of one paper.
pub const MIN_TWIN_PREFIX: usize = 32;

/// Longest author part, in UTF-16 units, of a `Author - Year - Title` file name.
const MAX_AUTHOR_PART: usize = 80;

/// One search hit, with its entity document already resolved by the caller.
#[derive(Clone, Debug, PartialEq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct CollapseHit {
    /// Document id.
    pub id: String,
    /// Entity the document belongs to.
    pub entity_id: String,
    /// Score the hit earned.
    pub score: f64,
    /// Whether the hit is a page of a PDF.
    pub is_pdf: bool,
    /// The paper's own document, for a PDF hit whose paper is indexed.
    pub entity_doc: Option<String>,
}

/// An entity's best hit after folding.
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct CollapsedEntity {
    /// Link target: the entity document when there is one, else the best hit.
    pub id: String,
    /// Best score any of the entity's documents earned.
    pub score: f64,
}

/// A related-list entry's document, as the web side resolved it.
#[derive(Clone, Debug, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ResolvedDoc {
    /// Search kind; a `pdf` page counts as its paper.
    pub kind: String,
    /// Entity the document belongs to.
    pub entity_id: String,
    /// Title, normalised by [`title_key`] before comparing.
    pub title: String,
}

/// One related-list entry: its id and the document it resolves to, if any.
#[derive(Clone, Debug, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct RelatedEntry {
    /// Entry id.
    pub id: String,
    /// What the id resolves to, or `None` when it does not resolve.
    pub doc: Option<ResolvedDoc>,
}

/// Input to [`distinct_related`].
#[derive(Clone, Debug, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct DistinctInput {
    /// Related entries, best first.
    pub entries: Vec<RelatedEntry>,
    /// The seed's document; its title counts as already listed.
    pub seed: Option<ResolvedDoc>,
    /// Maximum number kept; `None` for no limit.
    #[cfg_attr(feature = "specta", specta(type = Option<u32>))]
    pub limit: Option<usize>,
}

/// An entry that was absorbed into an earlier one.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct Merge {
    /// Index of the entry that was kept.
    #[cfg_attr(feature = "specta", specta(type = u32))]
    pub owner: usize,
    /// Index of the entry that was dropped.
    #[cfg_attr(feature = "specta", specta(type = u32))]
    pub dropped: usize,
}

/// Result of [`distinct_related`].
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct DistinctRelated {
    /// Indices of kept entries, in input order.
    #[cfg_attr(feature = "specta", specta(type = Vec<u32>))]
    pub kept: Vec<usize>,
    /// Absorbed entries, in the order they were met.
    pub merges: Vec<Merge>,
}

/// Fold hits onto the entity they belong to.
///
/// A PDF page stands in for its paper's document when the caller found one.
/// The seed's entity is dropped. Each entity keeps its best score, and its
/// link target is upgraded to the entity document when one was seen. Results
/// are sorted by score, highest first; ties keep first-seen order.
#[must_use]
pub fn collapse_hits(hits: &[CollapseHit], seed_entity_id: &str) -> Vec<CollapsedEntity> {
    let mut slots: Vec<CollapsedEntity> = Vec::new();
    let mut is_entity_doc: Vec<bool> = Vec::new();
    let mut slot_of: HashMap<&str, usize> = HashMap::new();
    for hit in hits {
        if hit.entity_id == seed_entity_id {
            continue;
        }
        let owner = if hit.is_pdf {
            hit.entity_doc.as_deref()
        } else {
            None
        };
        let entity_doc = !hit.is_pdf || owner.is_some();
        let target = owner.unwrap_or(hit.id.as_str());
        match slot_of.get(hit.entity_id.as_str()) {
            None => {
                let _ = slot_of.insert(hit.entity_id.as_str(), slots.len());
                slots.push(CollapsedEntity {
                    id: target.to_owned(),
                    score: hit.score,
                });
                is_entity_doc.push(entity_doc);
            }
            Some(&slot) => {
                let current = &mut slots[slot];
                current.score = current.score.max(hit.score);
                if entity_doc && !is_entity_doc[slot] {
                    current.id = target.to_owned();
                    is_entity_doc[slot] = true;
                }
            }
        }
    }
    slots.sort_by(|a, b| b.score.total_cmp(&a.score));
    slots
}

/// Drop related entries that name something already listed.
///
/// Two entries are the same when they resolve to the same entity, or to the
/// same normalised title within the same kind. The first (best-ranked) entry
/// wins, and each absorbed entry is reported through [`Merge`]. A truncated
/// copy of an already-listed title also counts as listed.
#[must_use]
pub fn distinct_related(input: &DistinctInput) -> DistinctRelated {
    let mut claims = Claims::default();
    if let Some(seed) = &input.seed {
        let key = title_key(&seed.title);
        if !key.is_empty() {
            claims.set(format!("title:{}:{key}", listed_kind(&seed.kind)), None);
        }
    }
    let mut kept = Vec::new();
    let mut merges = Vec::new();
    for (index, entry) in input.entries.iter().enumerate() {
        let keys = entry_keys(entry);
        let claimed = keys
            .iter()
            .find(|key| claims.contains(key))
            .cloned()
            .or_else(|| truncated_twin(&keys, &claims));
        if let Some(claimed) = claimed {
            if let Some(Some(owner)) = claims.get(&claimed) {
                merges.push(Merge {
                    owner,
                    dropped: index,
                });
            }
            continue;
        }
        if input.limit.is_some_and(|limit| kept.len() >= limit) {
            continue;
        }
        for key in keys {
            claims.set(key, Some(index));
        }
        kept.push(index);
    }
    DistinctRelated { kept, merges }
}

/// Kind used for claims: a PDF page is listed as its paper.
fn listed_kind(kind: &str) -> &str {
    if kind == "pdf" { "paper" } else { kind }
}

/// Keys that identify an entry: its entity, and its title within its kind.
fn entry_keys(entry: &RelatedEntry) -> Vec<String> {
    match &entry.doc {
        None => vec![format!("id:{}", entry.id)],
        Some(doc) => {
            let kind = listed_kind(&doc.kind);
            let mut keys = vec![format!("entity:{kind}:{}", doc.entity_id)];
            let key = title_key(&doc.title);
            if !key.is_empty() {
                keys.push(format!("title:{kind}:{key}"));
            }
            keys
        }
    }
}

/// Insertion-ordered claim table. `None` marks the seed.
#[derive(Default)]
struct Claims {
    order: Vec<(String, Option<usize>)>,
    position: HashMap<String, usize>,
}

impl Claims {
    fn contains(&self, key: &str) -> bool {
        self.position.contains_key(key)
    }

    fn get(&self, key: &str) -> Option<Option<usize>> {
        self.position.get(key).map(|&at| self.order[at].1)
    }

    fn set(&mut self, key: String, owner: Option<usize>) {
        match self.position.get(&key) {
            Some(&at) => self.order[at].1 = owner,
            None => {
                let _ = self.position.insert(key.clone(), self.order.len());
                self.order.push((key, owner));
            }
        }
    }
}

/// A claimed title key that is a truncated copy of one of `keys`' title, or the
/// other way round. Only long shared prefixes count, so two papers that both
/// begin "Attention" are not one paper.
fn truncated_twin(keys: &[String], claims: &Claims) -> Option<String> {
    let title = keys.iter().find(|key| key.starts_with("title:"))?;
    let kind_end = title[6..].find(':')? + 7;
    let kind = &title[..kind_end];
    let text = &title[kind_end..];
    if utf16_len(text) < MIN_TWIN_PREFIX {
        return None;
    }
    claims.order.iter().find_map(|(key, _)| {
        let other = key.strip_prefix(kind)?;
        if utf16_len(other) < MIN_TWIN_PREFIX {
            return None;
        }
        (other.starts_with(text) || text.starts_with(other)).then(|| key.clone())
    })
}

/// Normalised title used to recognise one paper under several names.
///
/// Lowercases, drops a `.pdf` file extension with an optional download marker
/// (` 1`, ` (2)`, ` copy`), drops a leading `Author - Year - ` prefix, then
/// replaces every run of non-letter, non-number characters with one space.
#[must_use]
pub fn title_key(title: &str) -> String {
    let lower = title.to_lowercase();
    let stem = strip_file_name_suffix(&lower);
    let body = strip_author_year_prefix(stem);
    body.split(|ch: char| !is_letter_or_number(ch))
        .filter(|word| !word.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

/// Removes `.pdf`, and a download marker before it when one is present.
fn strip_file_name_suffix(lower: &str) -> &str {
    let Some(stem) = lower.strip_suffix(".pdf") else {
        return lower;
    };
    strip_copy_marker(stem)
        .or_else(|| strip_number_marker(stem))
        .unwrap_or(stem)
}

/// ` copy` (one whitespace character, then `copy`), as the stem's tail.
fn strip_copy_marker(stem: &str) -> Option<&str> {
    let rest = stem.strip_suffix("copy")?;
    let before = rest.chars().next_back()?;
    is_js_whitespace(before).then_some(rest)
}

/// ` 1` to ` 99`, or ` (1)` to ` (99)`, as the stem's tail.
fn strip_number_marker(stem: &str) -> Option<&str> {
    if let Some(inner) = stem.strip_suffix(')') {
        let open = inner.rfind('(')?;
        let digits = &inner[open + 1..];
        return is_one_or_two_digits(digits).then(|| &inner[..open]);
    }
    let without = stem.trim_end_matches(|ch: char| ch.is_ascii_digit());
    let digits = stem.len() - without.len();
    let before = without.chars().next_back()?;
    (is_js_whitespace(before) && (1..=2).contains(&digits)).then_some(without)
}

fn is_one_or_two_digits(text: &str) -> bool {
    (1..=2).contains(&text.len()) && text.bytes().all(|byte| byte.is_ascii_digit())
}

/// Removes `Author - Year - ` (or `Author - n.d. - `) from the front.
fn strip_author_year_prefix(stem: &str) -> &str {
    let Some(dash) = stem.find('-') else {
        return stem;
    };
    let Some(author) = stem[..dash].strip_suffix(' ') else {
        return stem;
    };
    if author.is_empty() || utf16_len(author) > MAX_AUTHOR_PART {
        return stem;
    }
    let Some(after_dash) = stem[dash..].strip_prefix("- ") else {
        return stem;
    };
    let after_year = if after_dash
        .as_bytes()
        .get(..4)
        .is_some_and(|year| year.iter().all(u8::is_ascii_digit))
    {
        &after_dash[4..]
    } else if let Some(rest) = after_dash.strip_prefix("n.d.") {
        rest
    } else {
        return stem;
    };
    after_year.strip_prefix(" - ").unwrap_or(stem)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hit(id: &str, entity: &str, score: f64, is_pdf: bool, doc: Option<&str>) -> CollapseHit {
        CollapseHit {
            id: id.into(),
            entity_id: entity.into(),
            score,
            is_pdf,
            entity_doc: doc.map(Into::into),
        }
    }

    fn resolved(kind: &str, entity: &str, title: &str) -> ResolvedDoc {
        ResolvedDoc {
            kind: kind.into(),
            entity_id: entity.into(),
            title: title.into(),
        }
    }

    fn entry(id: &str, doc: Option<ResolvedDoc>) -> RelatedEntry {
        RelatedEntry { id: id.into(), doc }
    }

    #[test]
    fn collapse_drops_seed_and_stands_pages_in_for_their_paper() {
        let hits = vec![
            hit("pdf:a#9", "a", 3.0, true, Some("paper:a")),
            hit("pdf:a#1", "a", 5.0, true, Some("paper:a")),
            hit("note:x", "x", 4.0, false, None),
            hit("pdf:seed#0", "seed", 9.0, true, Some("paper:seed")),
        ];
        let folded = collapse_hits(&hits, "seed");
        assert_eq!(folded.len(), 2);
        assert_eq!(
            folded[0],
            CollapsedEntity {
                id: "paper:a".into(),
                score: 5.0
            }
        );
        assert_eq!(
            folded[1],
            CollapsedEntity {
                id: "note:x".into(),
                score: 4.0
            }
        );
    }

    #[test]
    fn collapse_keeps_best_page_when_paper_is_not_indexed() {
        let hits = vec![
            hit("pdf:a#2", "a", 1.0, true, None),
            hit("pdf:a#0", "a", 7.0, true, None),
        ];
        let folded = collapse_hits(&hits, "x");
        assert_eq!(
            folded,
            vec![CollapsedEntity {
                id: "pdf:a#2".into(),
                score: 7.0
            }]
        );
    }

    #[test]
    fn title_key_drops_extension_download_marker_and_author_year() {
        assert_eq!(
            title_key("Goyal et al. - 2017 - Nonparametric VAE.pdf"),
            "nonparametric vae"
        );
        assert_eq!(title_key("Deep Learning 1.pdf"), "deep learning");
        assert_eq!(title_key("Deep Learning (2).pdf"), "deep learning");
        assert_eq!(title_key("Deep Learning copy.pdf"), "deep learning");
        assert_eq!(title_key("Model 3 Things"), "model 3 things");
        assert_eq!(
            title_key("Attention, Is All You Need"),
            "attention is all you need"
        );
    }

    #[test]
    fn distinct_drops_same_entity_and_same_title_and_keeps_order() {
        let input = DistinctInput {
            entries: vec![
                entry("paper:a", Some(resolved("paper", "a", "Alpha"))),
                entry("pdf:a#0", Some(resolved("pdf", "a", "Alpha.pdf"))),
                entry("paper:b", Some(resolved("paper", "b", "Alpha"))),
                entry("paper:c", Some(resolved("paper", "c", "Gamma"))),
            ],
            seed: None,
            limit: None,
        };
        let out = distinct_related(&input);
        assert_eq!(out.kept, vec![0, 3]);
        assert_eq!(
            out.merges,
            vec![
                Merge {
                    owner: 0,
                    dropped: 1
                },
                Merge {
                    owner: 0,
                    dropped: 2
                }
            ]
        );
    }

    #[test]
    fn distinct_treats_seed_title_as_listed_and_respects_limit() {
        let input = DistinctInput {
            entries: vec![
                entry("paper:seedtwin", Some(resolved("paper", "s2", "The Seed"))),
                entry("paper:one", Some(resolved("paper", "o", "One"))),
                entry("paper:two", Some(resolved("paper", "t", "Two"))),
            ],
            seed: Some(resolved("paper", "s", "The Seed")),
            limit: Some(1),
        };
        let out = distinct_related(&input);
        assert_eq!(out.kept, vec![1]);
        assert!(out.merges.is_empty());
    }

    #[test]
    fn distinct_folds_a_cut_short_title_onto_its_full_twin() {
        let full = "Nonparametric Variational Auto-Encoders for Hierarchical Representation";
        let cut =
            "Goyal et al. - 2017 - Nonparametric Variational Auto-Encoders for Hierarchical R.pdf";
        let input = DistinctInput {
            entries: vec![
                entry("paper:full", Some(resolved("paper", "f", full))),
                entry("paper:cut", Some(resolved("paper", "c", cut))),
            ],
            seed: None,
            limit: None,
        };
        let out = distinct_related(&input);
        assert_eq!(out.kept, vec![0]);
        assert_eq!(
            out.merges,
            vec![Merge {
                owner: 0,
                dropped: 1
            }]
        );
    }

    #[test]
    fn distinct_keeps_unresolved_ids_by_id_only() {
        let input = DistinctInput {
            entries: vec![
                entry("gone", None),
                entry("gone", None),
                entry("other", None),
            ],
            seed: None,
            limit: None,
        };
        assert_eq!(distinct_related(&input).kept, vec![0, 2]);
    }
}
