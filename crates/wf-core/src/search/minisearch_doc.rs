//! The stored-document half of the MiniSearch index: filters, filter-only ranking, document
//! boosts, hit mapping and excerpts. MiniSearch itself (the inverted index) stays in TS, which
//! hands its candidates here. Replaces the non-engine logic of
//! `apps/web/src/features/search/infrastructure/minisearch-index.ts`.

use std::cmp::Ordering;
use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use super::excerpt::{Excerpt, ExcerptOptions, build_excerpt};
use super::query::{ParsedQuery, SearchKind};
use super::search_settings::{self, SearchSettings};
use super::search_tuning::{DocumentBoostOptions, RankedDoc, document_boost};

const DAY_MS: f64 = 86_400_000.0;
const EXCERPT_CHARS: usize = 200;

/// One stored document. Field order is the persisted order; `id` and `updated_ms` are inputs
/// only and are never persisted.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocRecord {
    /// Document id, supplied by the caller and never persisted.
    #[serde(default, skip_serializing)]
    pub id: String,
    /// Kind of entity this document represents.
    pub kind: SearchKind,
    /// Id of the underlying entity.
    pub entity_id: String,
    /// Display title.
    pub title: String,
    /// Link target for the hit.
    pub href: String,
    /// Last-updated timestamp as an ISO string, when known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
    /// Graph degree used for document boosting, when known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub degree: Option<f64>,
    /// Path of the entity, when it has one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    /// Tags attached to the entity.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
    /// Indexed body text.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    /// Page number for paged entities such as PDF pages.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page: Option<f64>,
    /// `Date.parse(updatedAt)` as computed by TS; `None` when it did not parse.
    #[serde(default, skip_serializing)]
    pub updated_ms: Option<f64>,
}

/// A MiniSearch result, as TS passes it in for `finish`.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    /// Document id.
    pub id: String,
    /// Raw MiniSearch score.
    pub score: f64,
    /// Index terms that matched the document.
    pub terms: Vec<String>,
    /// Query terms that produced the match.
    pub query_terms: Vec<String>,
}

/// A search hit. `excerpt` is filled by the wasm layer, which keeps its text as UTF-16.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    /// Document id.
    pub id: String,
    /// Kind of entity this hit represents.
    pub kind: SearchKind,
    /// Id of the underlying entity.
    pub entity_id: String,
    /// Display title.
    pub title: String,
    /// Link target for the hit.
    pub href: String,
    /// Relevance score.
    pub score: f64,
    /// Page number for paged entities, when set.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub page: Option<f64>,
    /// Last-updated timestamp, when known.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
    /// Index terms that matched the document.
    pub terms: Vec<String>,
    /// Query terms that produced the match, when tracked.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub query_terms: Option<Vec<String>>,
    /// Highlighted excerpt, filled in by the wasm layer.
    #[serde(skip)]
    pub excerpt: Option<Excerpt>,
}

/// Stored documents in JS `Map` order: a re-add keeps its slot, a remove leaves a gap.
#[derive(Default)]
pub struct DocStore {
    slots: Vec<Option<DocRecord>>,
    positions: HashMap<String, usize>,
    settings: Option<SearchSettings>,
}

impl DocStore {
    /// An empty store.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Replace the search settings used for filtering and ranking.
    pub fn set_settings(&mut self, settings: Option<SearchSettings>) {
        self.settings = settings;
    }

    /// Insert, or replace in place when the id is already held.
    pub fn put(&mut self, record: DocRecord) {
        if let Some(&slot) = self.positions.get(&record.id) {
            self.slots[slot] = Some(record);
        } else {
            let _ = self.positions.insert(record.id.clone(), self.slots.len());
            self.slots.push(Some(record));
        }
    }

    /// Remove by id; unknown ids are ignored.
    pub fn remove(&mut self, id: &str) {
        if let Some(slot) = self.positions.remove(id) {
            self.slots[slot] = None;
        }
    }

    /// Whether a document with this id is held.
    #[must_use]
    pub fn has(&self, id: &str) -> bool {
        self.positions.contains_key(id)
    }

    /// Drop every stored document.
    pub fn clear(&mut self) {
        self.slots.clear();
        self.positions.clear();
    }

    /// Every held `(id, document)` pair in insertion order.
    #[must_use]
    pub fn entries(&self) -> Vec<(&str, &DocRecord)> {
        self.slots
            .iter()
            .flatten()
            .map(|record| (record.id.as_str(), record))
            .collect()
    }

    /// Ids of every held document whose kind is in `kinds`.
    #[must_use]
    pub fn ids_of_kind(&self, kinds: &[SearchKind]) -> Vec<String> {
        self.slots
            .iter()
            .flatten()
            .filter(|record| kinds.contains(&record.kind))
            .map(|record| record.id.clone())
            .collect()
    }

    /// The hit for one document, scored as "not ranked by keyword": score 0, no terms.
    #[must_use]
    pub fn hit_by_id(&self, id: &str) -> Option<SearchHit> {
        let fields = self.get(id)?;
        Some(SearchHit {
            id: id.to_owned(),
            kind: fields.kind,
            entity_id: fields.entity_id.clone(),
            title: fields.title.clone(),
            href: fields.href.clone(),
            score: 0.0,
            page: fields.page,
            updated_at: non_empty(fields),
            terms: Vec::new(),
            query_terms: None,
            excerpt: None,
        })
    }

    /// The document boost MiniSearch applies to a candidate; 1 when the document is unknown.
    #[must_use]
    pub fn boost_of(&self, id: &str, now: f64) -> f64 {
        self.get(id)
            .map_or(1.0, |fields| score_of(fields, self.settings.as_ref(), now))
    }

    /// Every held document's boost in one pass: `ids[i]` has `boosts[i]`, in insertion order.
    #[must_use]
    pub fn boosts(&self, now: f64) -> (Vec<String>, Vec<f64>) {
        self.slots
            .iter()
            .flatten()
            .map(|record| (record.id.clone(), score_of(record, self.settings.as_ref(), now)))
            .unzip()
    }

    /// Filter-only query: enumerate every document, keep the matches, order by the document
    /// boost alone. The whole match set is sorted before the cut, so the best document is
    /// never dropped for sitting late in insertion order.
    #[must_use]
    pub fn filter_only(
        &self,
        query: &ParsedQuery,
        caller_kinds: Option<&[SearchKind]>,
        limit: usize,
        now: f64,
    ) -> Vec<SearchHit> {
        if is_empty_query(query) {
            return Vec::new();
        }
        let mut scored: Vec<(f64, SearchHit)> = self
            .slots
            .iter()
            .flatten()
            .filter(|fields| matches_filters(fields, query, caller_kinds, now))
            .map(|fields| {
                let score = score_of(fields, self.settings.as_ref(), now);
                let hit = SearchHit {
                    id: fields.id.clone(),
                    kind: fields.kind,
                    entity_id: fields.entity_id.clone(),
                    title: fields.title.clone(),
                    href: fields.href.clone(),
                    score,
                    page: None,
                    updated_at: non_empty(fields),
                    terms: Vec::new(),
                    query_terms: None,
                    excerpt: None,
                };
                (score, hit)
            })
            .collect();
        scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(Ordering::Equal));
        scored.into_iter().take(limit).map(|(_, hit)| hit).collect()
    }

    /// Ranked query: keep the MiniSearch candidates that pass the filters, best first, up to
    /// `limit`. `excerpt_units` is the UTF-16 cap for excerpts; `None` leaves them out.
    ///
    /// # Errors
    ///
    /// Fails when a hit's terms together need more than `excerpt_units` UTF-16 units.
    pub fn finish(
        &self,
        candidates: &[Candidate],
        query: &ParsedQuery,
        caller_kinds: Option<&[SearchKind]>,
        limit: usize,
        now: f64,
        excerpt_units: Option<usize>,
    ) -> Result<Vec<SearchHit>, String> {
        let mut hits = Vec::new();
        for candidate in candidates {
            if hits.len() >= limit {
                break;
            }
            let Some(fields) = self.get(&candidate.id) else {
                continue;
            };
            if !matches_filters(fields, query, caller_kinds, now) {
                continue;
            }
            let excerpt = match excerpt_units {
                Some(max) => Some(excerpt_of(
                    fields.body.as_deref().unwrap_or(""),
                    &candidate.terms,
                    max,
                )?),
                None => None,
            };
            hits.push(SearchHit {
                id: candidate.id.clone(),
                kind: fields.kind,
                entity_id: fields.entity_id.clone(),
                title: fields.title.clone(),
                href: fields.href.clone(),
                score: candidate.score,
                page: fields.page,
                updated_at: non_empty(fields),
                terms: candidate.terms.clone(),
                query_terms: Some(candidate.query_terms.clone()),
                excerpt,
            });
        }
        Ok(hits)
    }

    fn get(&self, id: &str) -> Option<&DocRecord> {
        self.positions
            .get(id)
            .and_then(|&slot| self.slots[slot].as_ref())
    }
}

fn non_empty(fields: &DocRecord) -> Option<String> {
    fields.updated_at.clone().filter(|value| !value.is_empty())
}

/// Nothing to search or filter on.
fn is_empty_query(query: &ParsedQuery) -> bool {
    query.text.is_empty()
        && query.kinds.is_empty()
        && query.paths.is_empty()
        && query.tags.is_empty()
        && query.exclude.is_empty()
        && query.modified_within_days.is_none()
}

/// Caller kinds and `kind:` in the query intersect; then `modified:`, path, tag, phrase and
/// exclusion. Phrases and exclusions read the raw text, since the index knows terms, not
/// adjacency.
fn matches_filters(
    fields: &DocRecord,
    query: &ParsedQuery,
    caller_kinds: Option<&[SearchKind]>,
    now: f64,
) -> bool {
    if caller_kinds.is_some_and(|kinds| !kinds.contains(&fields.kind)) {
        return false;
    }
    if !query.kinds.is_empty() && !query.kinds.contains(&fields.kind) {
        return false;
    }
    if let Some(days) = query.modified_within_days {
        let since = now - f64::from(days) * DAY_MS;
        if !fields.updated_ms.is_some_and(|ms| ms >= since) {
            return false;
        }
    }

    let path = fields.path.as_deref().unwrap_or("").to_lowercase();
    if !query.paths.iter().all(|needle| path.contains(needle.as_str())) {
        return false;
    }

    let tags: Vec<String> = fields
        .tags
        .iter()
        .flatten()
        .map(|tag| tag.to_lowercase())
        .collect();
    if !query.tags.iter().all(|needle| tags.contains(needle)) {
        return false;
    }

    if !query.phrases.is_empty() || !query.exclude.is_empty() {
        let haystack = format!(
            "{} {} {}",
            fields.title,
            path,
            fields.body.as_deref().unwrap_or("")
        )
        .to_lowercase();
        if !query
            .phrases
            .iter()
            .all(|phrase| haystack.contains(phrase.as_str()))
        {
            return false;
        }
        if query
            .exclude
            .iter()
            .any(|needle| haystack.contains(needle.as_str()))
        {
            return false;
        }
    }
    true
}

/// The document boost: link degree first, recency as a tiebreak, kind and settings applied.
fn score_of(fields: &DocRecord, settings: Option<&SearchSettings>, now: f64) -> f64 {
    let doc = RankedDoc {
        degree: fields.degree.unwrap_or(0.0),
        updated_at: fields.updated_at.clone().unwrap_or_default(),
    };
    let options = DocumentBoostOptions {
        recency_half_life_days: None,
        kind_multiplier: Some(search_settings::kind_multiplier(fields.kind, settings)),
        recency: settings.and_then(|value| value.recency_boost),
    };
    document_boost(&doc, &options, now)
}

/// Snippet of `body` around `terms`, failing when the terms alone exceed the cap.
fn excerpt_of(body: &str, terms: &[String], max_units: usize) -> Result<Excerpt, String> {
    let total: usize = terms
        .iter()
        .map(|term| term.encode_utf16().count() + 1)
        .sum();
    if total > max_units {
        return Err(format!(
            "terms need {total} UTF-16 units (length + 1 each); MAX_INDEX_TEXT_UTF16 is {max_units}"
        ));
    }
    Ok(build_excerpt(
        cap_utf16(body, max_units),
        terms,
        ExcerptOptions {
            max_chars: Some(EXCERPT_CHARS),
            single_line: true,
        },
    ))
}

/// The longest prefix of `text` within `max` UTF-16 units, cut on a character boundary.
fn cap_utf16(text: &str, max: usize) -> &str {
    let mut units = 0;
    for (index, ch) in text.char_indices() {
        units += ch.len_utf16();
        if units > max {
            return &text[..index];
        }
    }
    text
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::search::query::parse_query;

    const NOW: f64 = 1_800_000_000_000.0;

    fn record(id: &str, kind: SearchKind, title: &str) -> DocRecord {
        DocRecord {
            id: id.to_owned(),
            kind,
            entity_id: id.to_owned(),
            title: title.to_owned(),
            href: format!("/{id}"),
            updated_at: None,
            degree: None,
            path: None,
            tags: None,
            body: None,
            page: None,
            updated_ms: None,
        }
    }

    fn store_of(records: Vec<DocRecord>) -> DocStore {
        let mut store = DocStore::new();
        for record in records {
            store.put(record);
        }
        store
    }

    /// Two notes, one tagged, and a paper.
    fn corpus() -> DocStore {
        let mut n1 = record("n1", SearchKind::Note, "VAE notes");
        n1.tags = Some(vec!["vae".to_owned()]);
        store_of(vec![
            n1,
            record("n2", SearchKind::Note, "Attention"),
            record("n3", SearchKind::Note, "Diffusion"),
            record("p1", SearchKind::Paper, "Some paper"),
        ])
    }

    fn filter_only_for(
        store: &DocStore,
        query: &str,
        kinds: Option<&[SearchKind]>,
        limit: usize,
    ) -> Vec<SearchHit> {
        store.filter_only(&parse_query(query), kinds, limit, NOW)
    }

    #[test]
    fn boosts_matches_boost_of_for_every_document() {
        let store = corpus();
        let (ids, boosts) = store.boosts(NOW);
        assert_eq!(ids.len(), 4);
        assert_eq!(ids.len(), boosts.len());
        for (id, boost) in ids.iter().zip(&boosts) {
            assert_eq!(*boost, store.boost_of(id, NOW));
        }
    }

    // it: "kind: restricts results to that entity kind"
    #[test]
    fn kind_restricts_results_to_that_entity_kind() {
        let hits = filter_only_for(&corpus(), "kind:paper", None, 30);
        assert!(!hits.is_empty());
        assert!(hits.iter().all(|hit| matches!(hit.kind, SearchKind::Paper)));
    }

    // it: "a caller's kinds are intersected with kind:, never widened by it"
    #[test]
    fn callers_kinds_are_intersected_with_kind_never_widened_by_it() {
        let hits = filter_only_for(&corpus(), "kind:paper", Some(&[SearchKind::Note]), 30);
        assert!(hits.is_empty());
    }

    // it: "tag: filters on indexed tags"
    #[test]
    fn tag_filters_on_indexed_tags() {
        let hits = filter_only_for(&corpus(), "tag:vae", None, 30);
        assert!(!hits.is_empty());
        assert!(hits.iter().all(|hit| hit.entity_id == "n1"));
    }

    // it: "a filter-only query still returns results"
    #[test]
    fn filter_only_query_still_returns_results() {
        let hits = filter_only_for(&corpus(), "kind:note", None, 30);
        assert!(hits.len() >= 3);
        assert!(hits.iter().all(|hit| matches!(hit.kind, SearchKind::Note)));
    }

    // it: "an unknown kind: narrows to nothing rather than matching everything"
    #[test]
    fn unknown_kind_narrows_to_nothing_rather_than_matching_everything() {
        let hits = filter_only_for(&corpus(), "kind:banana", None, 30);
        assert!(hits.is_empty());
    }

    // it: "a filter-only query returns the best match even past the first limit*4 documents (27-04)"
    #[test]
    fn filter_only_returns_best_match_even_past_first_limit_times_four_documents() {
        let mut records: Vec<DocRecord> = (0..20)
            .map(|i| record(&format!("m{i}"), SearchKind::Note, &format!("Note {i}")))
            .collect();
        records[19].degree = Some(50.0);
        let store = store_of(records);
        let hits = filter_only_for(&store, "kind:note", None, 1);
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].id, "m19");
    }

    // it: "an empty query returns nothing rather than everything"
    #[test]
    fn empty_query_returns_nothing_rather_than_everything() {
        let hits = filter_only_for(&corpus(), "   ", None, 30);
        assert!(hits.is_empty());
    }
}
