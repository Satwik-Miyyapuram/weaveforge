//! Rules of the bibliography reference lookup: how a resolved entry is keyed and kept, how
//! long it answers, and the order its identifiers are tried in. Port of the pure parts of
//! `ReferenceLookupService` in `apps/web/src/features/reader/application/parts-2.ts`. The
//! resolver calls, the cache store and the library listing stay in TS.

use serde::{Deserialize, Serialize};

/// How long a stored lookup answers before it is resolved again: 30 days, in milliseconds.
pub const REFERENCE_CACHE_TTL_MS: f64 = 30.0 * 24.0 * 60.0 * 60.0 * 1000.0;

/// Version of the stored lookups. Bumped when what is stored changes meaning: 5 drops the
/// misses that version 4 kept.
pub const REFERENCE_CACHE_SCHEMA: u32 = 5;

/// How long one library listing answers title matches, in milliseconds.
pub const LIBRARY_LIST_TTL_MS: f64 = 30_000.0;

/// The store key of one bibliography entry within one document.
#[must_use]
pub fn reference_cache_key(document_key: &str, ref_index: f64) -> String {
    format!("v{REFERENCE_CACHE_SCHEMA}:{document_key}:ref:{ref_index}")
}

/// True while a stored lookup, stamped at `stored_at`, is still within its TTL at `now`.
#[must_use]
pub fn is_cache_entry_fresh(stored_at: f64, now: f64) -> bool {
    now - stored_at < REFERENCE_CACHE_TTL_MS
}

/// True while a library listing taken at `listed_at` still answers title matches at `now`.
#[must_use]
pub fn is_library_listing_fresh(listed_at: f64, now: f64) -> bool {
    now - listed_at < LIBRARY_LIST_TTL_MS
}

/// Only a resolved lookup is kept across sessions: a miss may be a dropped connection, or an
/// entry a later parser reads better.
#[must_use]
pub fn should_store_lookup(status: &str) -> bool {
    status == "resolved"
}

/// The identifiers and hints the parser found for one bibliography entry.
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LookupEntry {
    /// The entry's DOI, when it has one.
    #[serde(default)]
    pub doi: Option<String>,
    /// The entry's arXiv id, when it has one.
    #[serde(default)]
    pub arxiv_id: Option<String>,
    /// The entry's title, when it has one.
    #[serde(default)]
    pub title: Option<String>,
    /// The entry's publication year, when it has one.
    #[serde(default)]
    pub year: Option<f64>,
    /// The entry's first author, when it has one.
    #[serde(default)]
    pub first_author: Option<String>,
}

/// The hints a bibliographic search carries besides its title.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LookupHints {
    /// The title searched for.
    pub title: String,
    /// The publication year, when the entry has one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub year: Option<f64>,
    /// The first author, when the entry has one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub first_author: Option<String>,
}

/// One form an entry is offered to the resolver in: `doi`, `arxiv` or `bibliographic`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LookupAttempt {
    /// Which form this is.
    pub kind: &'static str,
    /// The DOI, arXiv id or title offered.
    pub value: String,
    /// The hints, for a bibliographic search only.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hints: Option<LookupHints>,
}

fn present(value: Option<&str>) -> Option<&str> {
    value.filter(|text| !text.is_empty())
}

/// The forms an entry is offered in, strongest identifier first. A form that fails hands over
/// to the next. An entry with no identifier and no title has no forms, so it is unresolved.
#[must_use]
pub fn lookup_attempts(entry: &LookupEntry) -> Vec<LookupAttempt> {
    let mut attempts = Vec::new();
    if let Some(doi) = present(entry.doi.as_deref()) {
        attempts.push(LookupAttempt {
            kind: "doi",
            value: doi.to_owned(),
            hints: None,
        });
    }
    if let Some(arxiv_id) = present(entry.arxiv_id.as_deref()) {
        attempts.push(LookupAttempt {
            kind: "arxiv",
            value: arxiv_id.to_owned(),
            hints: None,
        });
    }
    if let Some(title) = present(entry.title.as_deref()) {
        attempts.push(LookupAttempt {
            kind: "bibliographic",
            value: title.to_owned(),
            hints: Some(LookupHints {
                title: title.to_owned(),
                year: entry.year,
                first_author: present(entry.first_author.as_deref()).map(str::to_owned),
            }),
        });
    }
    attempts
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(doi: Option<&str>, arxiv_id: Option<&str>, title: Option<&str>) -> LookupEntry {
        LookupEntry {
            doi: doi.map(str::to_owned),
            arxiv_id: arxiv_id.map(str::to_owned),
            title: title.map(str::to_owned),
            year: None,
            first_author: None,
        }
    }

    #[test]
    fn cache_key_carries_the_schema_document_and_index() {
        assert_eq!(reference_cache_key("p1", 7.0), "v5:p1:ref:7");
    }

    #[test]
    fn a_stored_lookup_is_fresh_for_thirty_days_only() {
        let stamped = 1_000.0;
        assert!(is_cache_entry_fresh(
            stamped,
            stamped + REFERENCE_CACHE_TTL_MS - 1.0
        ));
        assert!(!is_cache_entry_fresh(
            stamped,
            stamped + REFERENCE_CACHE_TTL_MS
        ));
        assert_eq!(REFERENCE_CACHE_TTL_MS, 2_592_000_000.0);
    }

    #[test]
    fn a_library_listing_answers_for_thirty_seconds() {
        assert!(is_library_listing_fresh(0.0, 29_999.0));
        assert!(!is_library_listing_fresh(0.0, 30_000.0));
    }

    #[test]
    fn only_a_resolved_lookup_is_stored() {
        assert!(should_store_lookup("resolved"));
        assert!(!should_store_lookup("unresolved"));
        assert!(!should_store_lookup("pending"));
    }

    #[test]
    fn attempts_run_doi_then_arxiv_then_title() {
        let attempts = lookup_attempts(&entry(Some("10.1/x"), Some("2101.00001"), Some("A paper")));
        let kinds: Vec<&str> = attempts.iter().map(|a| a.kind).collect();
        assert_eq!(kinds, ["doi", "arxiv", "bibliographic"]);
    }

    #[test]
    fn an_entry_without_identifiers_or_title_has_no_attempts() {
        assert!(lookup_attempts(&entry(Some(""), None, None)).is_empty());
    }

    #[test]
    fn a_bibliographic_attempt_carries_year_and_first_author_hints() {
        let full = LookupEntry {
            year: Some(2017.0),
            first_author: Some("Vaswani".to_owned()),
            ..entry(None, None, Some("Attention"))
        };
        let attempts = lookup_attempts(&full);
        assert_eq!(attempts.len(), 1);
        assert_eq!(
            attempts[0].hints,
            Some(LookupHints {
                title: "Attention".to_owned(),
                year: Some(2017.0),
                first_author: Some("Vaswani".to_owned()),
            })
        );
    }
}
