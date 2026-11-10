//! Related-paper hits from Semantic Scholar and OpenAlex (TS `fetch-related-papers.ts` mappers).
//! The HTTP fetching stays in TypeScript; this module holds the field rules.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use super::paper::normalize_doi;
use super::related_paper_url::resolve_related_paper_url;
use crate::reader_analysis::lines::js_trim;

/// One neighbour of the seed paper. Absent fields serialize as `undefined`, the TS shape.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[cfg_attr(feature = "specta", serde(rename = "RelatedPaperHitRow"))]
#[serde(rename_all = "camelCase")]
pub struct RelatedPaperHit {
    /// Title.
    pub title: String,
    /// Authors.
    pub authors: Vec<String>,
    /// Year.
    pub year: Option<f64>,
    /// Doi.
    pub doi: Option<String>,
    /// Arxiv id.
    pub arxiv_id: Option<String>,
    /// Url.
    pub url: Option<String>,
    /// Abstract text.
    #[serde(rename = "abstract")]
    pub abstract_text: Option<String>,
    /// Citation count.
    pub citation_count: Option<f64>,
}

/// A Semantic Scholar paper as the API returns it.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct S2Paper {
    /// Title.
    pub title: Option<String>,
    /// Year.
    pub year: Option<f64>,
    /// Abstract text.
    #[serde(rename = "abstract")]
    pub abstract_text: Option<String>,
    /// Url.
    pub url: Option<String>,
    /// Citation count.
    pub citation_count: Option<f64>,
    /// A null entry is skipped, as a missing author is.
    pub authors: Option<Vec<Option<S2Author>>>,
    /// External ids.
    pub external_ids: Option<S2ExternalIds>,
}

/// Struct.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct S2Author {
    /// Name.
    pub name: Option<String>,
}

/// Struct.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct S2ExternalIds {
    /// Doi.
    #[serde(rename = "DOI")]
    pub doi: Option<String>,
    /// Arxiv.
    #[serde(rename = "ArXiv")]
    pub arxiv: Option<String>,
}

/// An OpenAlex work as the API returns it.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "snake_case", default)]
pub struct OpenAlexWork {
    /// Title.
    pub title: Option<String>,
    /// Doi.
    pub doi: Option<String>,
    /// Publication year.
    pub publication_year: Option<f64>,
    /// A null entry is skipped, as a missing authorship is.
    pub authorships: Option<Vec<Option<OpenAlexAuthorship>>>,
    /// Cited by count.
    pub cited_by_count: Option<f64>,
    /// Abstract inverted index.
    pub abstract_inverted_index: Option<Map<String, Value>>,
}

/// Struct.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct OpenAlexAuthorship {
    /// Author.
    pub author: Option<OpenAlexAuthor>,
}

/// Struct.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct OpenAlexAuthor {
    /// Display name.
    pub display_name: Option<String>,
}

/// The hit for a Semantic Scholar paper, or `None` when it has no title.
#[must_use]
pub fn s2_to_hit(paper: &S2Paper) -> Option<RelatedPaperHit> {
    let title = trimmed(paper.title.as_deref())?;
    let ids = paper.external_ids.as_ref();
    let doi = normalize_doi(ids.and_then(|ids| ids.doi.as_deref())).filter(|d| !d.is_empty());
    let arxiv = trimmed(ids.and_then(|ids| ids.arxiv.as_deref()));
    let authors = paper
        .authors
        .iter()
        .flatten()
        .filter_map(|author| trimmed(author.as_ref()?.name.as_deref()))
        .map(str::to_owned)
        .collect();
    let url = resolve_related_paper_url(paper.url.as_deref(), doi.as_deref(), arxiv);
    Some(RelatedPaperHit {
        title: title.to_owned(),
        authors,
        year: paper.year,
        doi,
        arxiv_id: arxiv.map(str::to_owned),
        url,
        abstract_text: trimmed(paper.abstract_text.as_deref()).map(str::to_owned),
        citation_count: to_count(paper.citation_count),
    })
}

/// The hit for an OpenAlex work, or `None` when it has no title.
#[must_use]
pub fn openalex_to_hit(work: &OpenAlexWork) -> Option<RelatedPaperHit> {
    let title = trimmed(work.title.as_deref())?;
    let doi = normalize_doi(work.doi.as_deref()).filter(|d| !d.is_empty());
    let authors = work
        .authorships
        .iter()
        .flatten()
        .filter_map(|authorship| {
            trimmed(
                authorship
                    .as_ref()?
                    .author
                    .as_ref()?
                    .display_name
                    .as_deref(),
            )
            .map(str::to_owned)
        })
        .collect();
    let url = resolve_related_paper_url(None, doi.as_deref(), None);
    Some(RelatedPaperHit {
        title: title.to_owned(),
        authors,
        year: work.publication_year,
        doi,
        arxiv_id: None,
        url,
        abstract_text: inverted_abstract(work.abstract_inverted_index.as_ref()),
        citation_count: to_count(work.cited_by_count),
    })
}

/// Puts an OpenAlex word -> positions index back into the abstract text. Positions that are not
/// whole array indexes are ignored, and a later word overwrites an earlier one at the same place.
#[must_use]
pub fn inverted_abstract(index: Option<&Map<String, Value>>) -> Option<String> {
    let index = index?;
    let mut keys: Vec<&String> = index.keys().collect();
    // JS enumerates integer-like keys first, ascending, then the rest in insertion order.
    keys.sort_by_key(|key| array_index(key).map_or((1u8, 0u32), |i| (0u8, i)));
    let mut words: BTreeMap<u32, &str> = BTreeMap::new();
    for key in keys {
        let Some(positions) = index.get(key).and_then(Value::as_array) else {
            continue;
        };
        for at in positions {
            if let Some(at) = at
                .as_f64()
                .filter(|n| n.fract() == 0.0 && *n >= 0.0 && *n < 4_294_967_295.0)
            {
                // Whole, non-negative and below u32::MAX, as the filter above checks: the cast is exact.
                #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
                let _ = words.insert(at as u32, key.as_str());
            }
        }
    }
    let text = words
        .values()
        .filter(|word| !word.is_empty())
        .copied()
        .collect::<Vec<_>>()
        .join(" ");
    (!text.is_empty()).then_some(text)
}

/// The seed's DOI, or for an arXiv paper the arXiv DOI OpenAlex files it under (version stripped).
#[must_use]
pub fn seed_doi(doi: Option<&str>, arxiv_id: Option<&str>) -> Option<String> {
    if let Some(doi) = normalize_doi(doi).filter(|d| !d.is_empty()) {
        return Some(doi);
    }
    let arxiv = strip_arxiv_version(trimmed(arxiv_id)?);
    (!arxiv.is_empty()).then(|| format!("10.48550/arXiv.{arxiv}"))
}

/// Non-empty after JS trim, or `None`.
fn trimmed(text: Option<&str>) -> Option<&str> {
    text.map(js_trim).filter(|text| !text.is_empty())
}

/// A count as JS reads it: a finite number, truncated, and never below zero.
fn to_count(n: Option<f64>) -> Option<f64> {
    let whole = n.filter(|n| n.is_finite())?.trunc();
    Some(if whole > 0.0 { whole } else { 0.0 })
}

/// The integer a JS array-index key names, or `None` for any other key.
fn array_index(key: &str) -> Option<u32> {
    let index: u32 = key.parse().ok()?;
    (index.to_string() == key && index != u32::MAX).then_some(index)
}

/// Drops a trailing `v<digits>` version, ignoring ASCII case (TS `replace(/v\d+$/i, "")`).
fn strip_arxiv_version(id: &str) -> &str {
    match id.rfind(['v', 'V']) {
        Some(at) if is_ascii_digits(&id[at + 1..]) => &id[..at],
        _ => id,
    }
}

fn is_ascii_digits(text: &str) -> bool {
    !text.is_empty() && text.bytes().all(|byte| byte.is_ascii_digit())
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn index(value: Value) -> Map<String, Value> {
        (match value {
            serde_json::Value::Object(map) => Some(map),
            _ => None,
        })
        .expect("object")
    }

    #[test]
    fn s2_hit_trims_fields_and_skips_blank_title() {
        let paper = S2Paper {
            title: Some("  Deep Thing  ".to_owned()),
            authors: Some(vec![
                Some(S2Author {
                    name: Some(" Ada ".to_owned()),
                }),
                Some(S2Author {
                    name: Some("   ".to_owned()),
                }),
            ]),
            external_ids: Some(S2ExternalIds {
                doi: Some("https://doi.org/10.1/ABC".to_owned()),
                arxiv: Some(" 2401.0001 ".to_owned()),
            }),
            citation_count: Some(7.9),
            ..S2Paper::default()
        };
        let hit = s2_to_hit(&paper).expect("hit");
        assert_eq!(hit.title, "Deep Thing");
        assert_eq!(hit.authors, vec!["Ada"]);
        assert_eq!(hit.doi.as_deref(), Some("10.1/abc"));
        assert_eq!(hit.arxiv_id.as_deref(), Some("2401.0001"));
        assert_eq!(hit.url.as_deref(), Some("https://doi.org/10.1/abc"));
        assert_eq!(hit.citation_count, Some(7.0));
        let blank = S2Paper {
            title: Some("  ".to_owned()),
            ..S2Paper::default()
        };
        assert_eq!(s2_to_hit(&blank), None);
    }

    #[test]
    fn openalex_hit_reads_authors_and_abstract() {
        let work = OpenAlexWork {
            title: Some("Work".to_owned()),
            doi: Some("https://doi.org/10.9/OA".to_owned()),
            publication_year: Some(2024.0),
            authorships: Some(vec![Some(OpenAlexAuthorship {
                author: Some(OpenAlexAuthor {
                    display_name: Some(" Ada L ".to_owned()),
                }),
            })]),
            cited_by_count: Some(12.0),
            abstract_inverted_index: Some(index(json!({ "world": [1], "Hello": [0] }))),
        };
        let hit = openalex_to_hit(&work).expect("hit");
        assert_eq!(hit.authors, vec!["Ada L"]);
        assert_eq!(hit.doi.as_deref(), Some("10.9/oa"));
        assert_eq!(hit.arxiv_id, None);
        assert_eq!(hit.abstract_text.as_deref(), Some("Hello world"));
        assert_eq!(hit.citation_count, Some(12.0));
    }

    #[test]
    fn inverted_abstract_keeps_whole_positions_and_order() {
        assert_eq!(
            inverted_abstract(Some(&index(
                json!({ "b": [2], "a": [0, 1.5, -1], "c": [1] })
            ))),
            Some("a c b".to_owned())
        );
        // A later word takes over a position, and an empty word leaves a gap that is dropped.
        assert_eq!(
            inverted_abstract(Some(&index(json!({ "x": [0], "y": [0], "": [1] })))),
            Some("y".to_owned())
        );
        assert_eq!(
            inverted_abstract(Some(&index(json!({ "1": [0], "z": [0] })))),
            Some("z".to_owned())
        );
        assert_eq!(inverted_abstract(None), None);
        assert_eq!(inverted_abstract(Some(&index(json!({ "x": [] })))), None);
    }

    #[test]
    fn seed_doi_prefers_doi_then_arxiv_without_version() {
        assert_eq!(
            seed_doi(Some("10.1/Seed"), Some("2401.00001v2")).as_deref(),
            Some("10.1/seed")
        );
        assert_eq!(
            seed_doi(None, Some(" 2401.00001V2 ")).as_deref(),
            Some("10.48550/arXiv.2401.00001")
        );
        assert_eq!(seed_doi(Some("  "), Some("v3")), None);
        assert_eq!(seed_doi(None, None), None);
    }

    #[test]
    fn counts_truncate_and_floor_at_zero() {
        assert_eq!(to_count(Some(-0.5)), Some(0.0));
        assert_eq!(to_count(Some(3.9)), Some(3.0));
        assert_eq!(to_count(None), None);
    }

    #[test]
    fn s2_minimal_and_null_fields_map_without_error() {
        let minimal: S2Paper = serde_json::from_value(json!({ "paperId": "p1" })).expect("parses");
        assert_eq!(s2_to_hit(&minimal), None);
        let nulls: S2Paper = serde_json::from_value(json!({
            "paperId": "p1",
            "title": "T",
            "authors": [null, { "name": "A" }],
            "externalIds": null,
            "abstract": null
        }))
        .expect("parses");
        let hit = s2_to_hit(&nulls).expect("hit");
        assert_eq!(hit.authors, vec!["A"]);
        assert_eq!(hit.doi, None);
        assert_eq!(hit.abstract_text, None);
    }

    #[test]
    fn openalex_minimal_and_null_fields_map_without_error() {
        let minimal: OpenAlexWork =
            serde_json::from_value(json!({ "id": "https://openalex.org/W1" })).expect("parses");
        assert_eq!(openalex_to_hit(&minimal), None);
        let nulls: OpenAlexWork = serde_json::from_value(json!({
            "id": "W1",
            "title": "T",
            "authorships": [null, { "author": null }, { "author": { "display_name": "B" } }],
            "abstract_inverted_index": null
        }))
        .expect("parses");
        let hit = openalex_to_hit(&nulls).expect("hit");
        assert_eq!(hit.authors, vec!["B"]);
        assert_eq!(hit.abstract_text, None);
    }

    #[test]
    fn inverted_abstract_minimal_object_is_none() {
        let empty: Map<String, Value> = serde_json::from_value(json!({})).expect("parses");
        assert_eq!(inverted_abstract(Some(&empty)), None);
    }

    #[test]
    fn seed_doi_minimal_arxiv_id_maps_to_arxiv_doi() {
        assert_eq!(
            seed_doi(None, Some("2401.00001")).as_deref(),
            Some("10.48550/arXiv.2401.00001")
        );
    }
}
