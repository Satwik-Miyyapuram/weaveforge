//! Candidate assembly for the Semantic Scholar citation source (TS
//! `apps/web/.../relations/infrastructure/semantic-scholar-citation-source.ts`: `citations()` and
//! the alignment rule in `referencesBatch()`). The HTTP calls, paging loop and batch chunking stay
//! in TypeScript; this module maps the JSON the API returns into the shapes the app keeps.

use serde::Serialize;
use serde_json::Value;

use super::semantic_scholar_citation::{
    S2ExternalIds, citation_contexts, citation_intents, external_id_ref,
};
use crate::papers::paper_ref::PaperRef;
use crate::reader_analysis::lines::js_trim;

/// One incoming citation as the citation source hands it to the app (TS `CitationCandidate`).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CitationCandidate {
    /// Semantic Scholar paper id, trimmed and never empty.
    pub id: String,
    /// Paper title, trimmed and never empty.
    pub title: String,
    /// Author names, each trimmed; blank names are dropped.
    pub authors: Vec<String>,
    /// Publication year, when Semantic Scholar reports one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub year: Option<f64>,
    /// The paper's link: Semantic Scholar's own url, else its paper page.
    pub url: String,
    /// Whole, non-negative citation count, when reported as a finite number.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub citation_count: Option<f64>,
    /// Trimmed citation context snippets, when any remain.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contexts: Option<Vec<String>>,
    /// Known citation intents (`background`, `method`, `result`), when any remain.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub intents: Option<Vec<String>>,
    /// Whether Semantic Scholar marks the citation influential, when it sent a boolean.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_influential: Option<bool>,
}

/// Candidates from one page of `/citations` edges, in order. Edges without a citing paper, or
/// without a usable id and title, are skipped (TS `citations()` loop body).
#[must_use]
pub fn citation_candidates(edges: &Value) -> Vec<CitationCandidate> {
    edges
        .as_array()
        .map(|items| items.iter().filter_map(citation_candidate).collect())
        .unwrap_or_default()
}

/// The candidate for one `/citations` edge, or `None` when it has no citing paper or the paper
/// has no usable id or title.
#[must_use]
pub fn citation_candidate(edge: &Value) -> Option<CitationCandidate> {
    let paper = field(edge, "citingPaper");
    if paper.is_null() {
        return None;
    }
    let id = trimmed(field(paper, "paperId"))?;
    let title = trimmed(field(paper, "title"))?;
    let url = match field(paper, "url").as_str() {
        Some(url) => url.to_owned(),
        None => format!("https://www.semanticscholar.org/paper/{id}"),
    };
    let citation_count = field(paper, "citationCount")
        .as_f64()
        .filter(|count| count.is_finite())
        // `+ 0.0` turns a negative zero into the positive zero that `Math.max(0, ...)` gives.
        .map(|count| count.trunc().max(0.0) + 0.0);
    Some(CitationCandidate {
        id,
        title,
        authors: authors(field(paper, "authors")),
        year: field(paper, "year").as_f64(),
        url,
        citation_count,
        contexts: citation_contexts(field(edge, "contexts")),
        intents: citation_intents(field(edge, "intents")),
        is_influential: field(edge, "isInfluential").as_bool(),
    })
}

/// The reference lists for one `/paper/batch` chunk, one entry per input id (`None` when that
/// paper or its references are missing).
///
/// # Errors
///
/// Returns the message to throw when `data` is not an array of `chunk_len` items. Semantic
/// Scholar returns one entry per requested id, in order; a mismatch would misalign references
/// to the wrong papers, so it fails instead.
pub fn batch_reference_lists(
    data: &Value,
    chunk_len: usize,
) -> Result<Vec<Option<Vec<PaperRef>>>, String> {
    let Some(items) = data.as_array() else {
        return Err(format!(
            "Semantic Scholar batch returned ? items for {chunk_len} ids."
        ));
    };
    if items.len() != chunk_len {
        return Err(format!(
            "Semantic Scholar batch returned {} items for {chunk_len} ids.",
            items.len()
        ));
    }
    Ok(items.iter().map(batch_item_references).collect())
}

/// The references of one batch entry, or `None` when the entry or its `references` is missing.
fn batch_item_references(item: &Value) -> Option<Vec<PaperRef>> {
    let references = field(item, "references").as_array()?;
    Some(
        references
            .iter()
            .filter_map(|reference| {
                let ids: Option<S2ExternalIds> = serde_json::from_value::<Option<S2ExternalIds>>(
                    field(reference, "externalIds").clone(),
                )
                .ok()
                .flatten();
                external_id_ref(ids.as_ref())
            })
            .collect(),
    )
}

/// Author names: each trimmed, blanks dropped. A non-array list gives none.
fn authors(raw: &Value) -> Vec<String> {
    raw.as_array()
        .map(|list| {
            list.iter()
                .filter_map(|author| trimmed(field(author, "name")))
                .collect()
        })
        .unwrap_or_default()
}

/// A string field, trimmed; `None` when absent, not a string, or blank after trimming.
fn trimmed(value: &Value) -> Option<String> {
    value
        .as_str()
        .map(|text| js_trim(text).to_owned())
        .filter(|text| !text.is_empty())
}

/// A field of a JSON object; `null` when absent or when `value` is not an object.
fn field<'a>(value: &'a Value, key: &str) -> &'a Value {
    static NULL: Value = Value::Null;
    value.get(key).unwrap_or(&NULL)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn edge(paper: Value) -> Value {
        json!({ "citingPaper": paper })
    }

    #[test]
    fn candidate_trims_fields_and_drops_blank_authors() {
        let candidate = citation_candidate(&edge(json!({
            "paperId": "  p1  ",
            "title": " A title ",
            "authors": [{ "name": " Ada " }, { "name": "   " }, { "name": null }, { "name": "Bo" }],
            "year": 2024,
        })))
        .expect("candidate");
        assert_eq!(candidate.id, "p1");
        assert_eq!(candidate.title, "A title");
        assert_eq!(candidate.authors, vec!["Ada".to_owned(), "Bo".to_owned()]);
        assert_eq!(candidate.year, Some(2024.0));
    }

    #[test]
    fn missing_id_or_title_skips_the_edge() {
        assert_eq!(
            citation_candidate(&edge(json!({ "paperId": " ", "title": "T" }))),
            None
        );
        assert_eq!(
            citation_candidate(&edge(json!({ "paperId": "p", "title": "   " }))),
            None
        );
        assert_eq!(citation_candidate(&json!({ "citingPaper": null })), None);
        assert_eq!(citation_candidate(&json!({})), None);
    }

    #[test]
    fn url_falls_back_to_the_paper_page_only_when_null() {
        let fallback =
            citation_candidate(&edge(json!({ "paperId": "p9", "title": "T" }))).expect("candidate");
        assert_eq!(fallback.url, "https://www.semanticscholar.org/paper/p9");
        let own = citation_candidate(&edge(json!({
            "paperId": "p9", "title": "T", "url": "https://example.org/x",
        })))
        .expect("candidate");
        assert_eq!(own.url, "https://example.org/x");
        // An empty string is not null, so it is kept, as `??` keeps it.
        let empty = citation_candidate(&edge(json!({ "paperId": "p9", "title": "T", "url": "" })))
            .expect("candidate");
        assert_eq!(empty.url, "");
    }

    #[test]
    fn citation_count_is_a_non_negative_whole_number() {
        let count = |raw: Value| {
            citation_candidate(&edge(
                json!({ "paperId": "p", "title": "T", "citationCount": raw }),
            ))
            .and_then(|candidate| candidate.citation_count)
        };
        assert_eq!(count(json!(7.9)), Some(7.0));
        assert_eq!(count(json!(-3)), Some(0.0));
        assert_eq!(count(json!(-0.5)), Some(0.0));
        assert_eq!(count(json!("12")), None);
        assert_eq!(count(Value::Null), None);
    }

    #[test]
    fn edge_level_fields_map_through_their_rules() {
        let candidate = citation_candidate(&json!({
            "citingPaper": { "paperId": "p", "title": "T" },
            "contexts": ["  see here  ", ""],
            "intents": ["method", "unknown"],
            "isInfluential": true,
        }))
        .expect("candidate");
        assert_eq!(candidate.contexts, Some(vec!["see here".to_owned()]));
        assert_eq!(candidate.intents, Some(vec!["method".to_owned()]));
        assert_eq!(candidate.is_influential, Some(true));

        let plain = citation_candidate(&json!({
            "citingPaper": { "paperId": "p", "title": "T" },
            "isInfluential": "yes",
        }))
        .expect("candidate");
        assert_eq!(plain.contexts, None);
        assert_eq!(plain.intents, None);
        assert_eq!(plain.is_influential, None);
    }

    #[test]
    fn page_keeps_order_and_skips_bad_edges() {
        let page = json!([
            { "citingPaper": null },
            { "citingPaper": { "paperId": "a", "title": "A" } },
            { "citingPaper": { "paperId": "", "title": "B" } },
            { "citingPaper": { "paperId": "c", "title": "C" } },
        ]);
        let ids: Vec<String> = citation_candidates(&page)
            .into_iter()
            .map(|candidate| candidate.id)
            .collect();
        assert_eq!(ids, vec!["a".to_owned(), "c".to_owned()]);
        assert!(citation_candidates(&json!("nope")).is_empty());
    }

    #[test]
    fn batch_entries_map_to_references_or_none() {
        let data = json!([
            { "references": [
                { "externalIds": { "ArXiv": "2401.00001", "DOI": "10.1/x" } },
                { "externalIds": { "DOI": "10.1/y" } },
                { "externalIds": null },
            ] },
            null,
            { "references": null },
            { "references": [] },
        ]);
        let lists = batch_reference_lists(&data, 4).expect("aligned");
        assert_eq!(
            lists[0],
            Some(vec![
                PaperRef {
                    kind: crate::papers::paper_ref::PaperRefKind::Arxiv,
                    value: "2401.00001".to_owned(),
                },
                PaperRef {
                    kind: crate::papers::paper_ref::PaperRefKind::Doi,
                    value: "10.1/y".to_owned(),
                },
            ])
        );
        assert_eq!(lists[1], None);
        assert_eq!(lists[2], None);
        assert_eq!(lists[3], Some(Vec::new()));
    }

    #[test]
    fn batch_length_mismatch_is_an_error_with_the_ts_message() {
        assert_eq!(
            batch_reference_lists(&json!([null, null]), 3),
            Err("Semantic Scholar batch returned 2 items for 3 ids.".to_owned())
        );
        assert_eq!(
            batch_reference_lists(&json!({ "a": 1 }), 2),
            Err("Semantic Scholar batch returned ? items for 2 ids.".to_owned())
        );
    }
}
