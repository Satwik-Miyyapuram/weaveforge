//! Field rules for the Semantic Scholar citation source (TS
//! `apps/web/.../relations/infrastructure/semantic-scholar-citation-source.ts`). The HTTP
//! fetching and paging loop stay in TypeScript; this module holds the mapping and the stop rule.

use serde::Deserialize;
use serde_json::Value;

use crate::papers::paper_ref::{PaperRef, PaperRefKind};
use crate::reader_analysis::lines::js_trim;

/// Intents Semantic Scholar reports for a citing paper (TS `CITATION_INTENTS`).
const CITATION_INTENTS: [&str; 3] = ["background", "method", "result"];

/// Pages followed for one listing before stopping (TS `MAX_CITATION_PAGES`).
pub const MAX_CITATION_PAGES: f64 = 50.0;

/// The Graph API rejects offsets at or above this value (TS `S2_MAX_OFFSET`).
pub const S2_MAX_OFFSET: f64 = 10_000.0;

/// A paper's external ids as Semantic Scholar names them (TS `S2ExternalIds`).
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
pub struct S2ExternalIds {
    /// arXiv id, when Semantic Scholar has one.
    #[serde(rename = "ArXiv", default)]
    pub arxiv: Option<String>,
    /// DOI, when Semantic Scholar has one.
    #[serde(rename = "DOI", default)]
    pub doi: Option<String>,
}

/// Trimmed, non-empty context snippets; `None` when none remain (TS `mapContexts`).
#[must_use]
pub fn citation_contexts(raw: &Value) -> Option<Vec<String>> {
    let contexts: Vec<String> = raw
        .as_array()?
        .iter()
        .filter_map(Value::as_str)
        .map(js_trim)
        .filter(|text| !text.is_empty())
        .map(str::to_owned)
        .collect();
    (!contexts.is_empty()).then_some(contexts)
}

/// Intents limited to the known ones; `None` when none remain (TS `mapIntents`).
#[must_use]
pub fn citation_intents(raw: &Value) -> Option<Vec<String>> {
    let intents: Vec<String> = raw
        .as_array()?
        .iter()
        .filter_map(Value::as_str)
        .filter(|intent| CITATION_INTENTS.contains(intent))
        .map(str::to_owned)
        .collect();
    (!intents.is_empty()).then_some(intents)
}

/// The reference to look a paper up by: arXiv first, then DOI (TS `extId`). An empty id is
/// absent, as the JS truthiness check treated it.
#[must_use]
pub fn external_id_ref(ids: Option<&S2ExternalIds>) -> Option<PaperRef> {
    let ids = ids?;
    if let Some(arxiv) = non_empty(ids.arxiv.as_deref()) {
        return Some(PaperRef {
            kind: PaperRefKind::Arxiv,
            value: arxiv.to_owned(),
        });
    }
    non_empty(ids.doi.as_deref()).map(|doi| PaperRef {
        kind: PaperRefKind::Doi,
        value: doi.to_owned(),
    })
}

/// The Semantic Scholar id for a reference (TS `s2Id`). Only arXiv gets the `ARXIV:` prefix;
/// every other kind is addressed as a DOI, as the TS did.
#[must_use]
pub fn s2_paper_id(kind: PaperRefKind, value: &str) -> String {
    match kind {
        PaperRefKind::Arxiv => format!("ARXIV:{value}"),
        _ => format!("DOI:{value}"),
    }
}

/// The next offset to request, or `-1` to stop (TS `nextPageOffset`). Stops on the page cap,
/// a missing or non-finite `next`, a `next` that does not advance, or the offset ceiling.
#[must_use]
pub fn next_page_offset(current_offset: f64, next: Option<f64>, pages_fetched: f64) -> f64 {
    if pages_fetched >= MAX_CITATION_PAGES {
        return -1.0;
    }
    match next {
        Some(next) if next.is_finite() && next > current_offset && next < S2_MAX_OFFSET => next,
        _ => -1.0,
    }
}

fn non_empty(value: Option<&str>) -> Option<&str> {
    value.filter(|text| !text.is_empty())
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn contexts_are_trimmed_and_empty_ones_dropped() {
        assert_eq!(
            citation_contexts(&json!(["  a  ", "", "   ", "b"])),
            Some(vec!["a".to_owned(), "b".to_owned()])
        );
        assert_eq!(citation_contexts(&json!(["  "])), None);
        assert_eq!(citation_contexts(&json!("not a list")), None);
    }

    #[test]
    fn intents_keep_only_known_values() {
        assert_eq!(
            citation_intents(&json!(["method", "other", "result"])),
            Some(vec!["method".to_owned(), "result".to_owned()])
        );
        assert_eq!(citation_intents(&json!(["other"])), None);
    }

    #[test]
    fn external_id_prefers_arxiv_and_treats_empty_as_absent() {
        let both = S2ExternalIds {
            arxiv: Some("2401.00001".to_owned()),
            doi: Some("10.1/x".to_owned()),
        };
        assert_eq!(
            external_id_ref(Some(&both)),
            Some(PaperRef {
                kind: PaperRefKind::Arxiv,
                value: "2401.00001".to_owned(),
            })
        );
        let empty_arxiv = S2ExternalIds {
            arxiv: Some(String::new()),
            doi: Some("10.1/x".to_owned()),
        };
        assert_eq!(
            external_id_ref(Some(&empty_arxiv)).map(|r| r.kind),
            Some(PaperRefKind::Doi)
        );
        assert_eq!(external_id_ref(None), None);
    }

    #[test]
    fn s2_id_prefixes_by_kind() {
        assert_eq!(
            s2_paper_id(PaperRefKind::Arxiv, "2401.00001"),
            "ARXIV:2401.00001"
        );
        assert_eq!(s2_paper_id(PaperRefKind::Doi, "10.1/x"), "DOI:10.1/x");
    }

    #[test]
    fn next_offset_advances_and_stops_on_each_guard() {
        assert_eq!(next_page_offset(0.0, Some(1000.0), 1.0), 1000.0);
        assert_eq!(next_page_offset(0.0, None, 1.0), -1.0);
        assert_eq!(next_page_offset(0.0, Some(f64::NAN), 1.0), -1.0);
        assert_eq!(next_page_offset(1000.0, Some(1000.0), 1.0), -1.0);
        assert_eq!(next_page_offset(0.0, Some(10_000.0), 1.0), -1.0);
        assert_eq!(next_page_offset(0.0, Some(1000.0), 50.0), -1.0);
    }
}
