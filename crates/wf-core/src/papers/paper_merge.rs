//! Merging a duplicate paper into the copy kept (TS
//! `features/papers/application/library-tidy.ts`, `mergePaperInto`). Pure: it returns the
//! merged paper and writes nothing.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use super::paper::{PaperStatus, normalize_tags};
use super::paper_title::is_placeholder_title;

/// Metadata keys that tie a row to one outside record and must not be copied.
const OWN_METADATA: &[&str] = &[
    "zoteroKey",
    "zoteroVersion",
    "zoteroLibraryId",
    "zoteroAttachmentKey",
    "mergedFrom",
];

/// One paper as the merge reads and writes it (the TS `Paper`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct MergePaper {
    /// Paper id.
    pub id: String,
    /// Title.
    pub title: String,
    /// Authors, in order.
    #[serde(default)]
    pub authors: Vec<String>,
    /// Publication year.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub year: Option<f64>,
    /// Venue.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub venue: Option<String>,
    /// DOI.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub doi: Option<String>,
    /// arXiv id.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub arxiv_id: Option<String>,
    /// Link.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub url: Option<String>,
    /// Attached PDF path.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub pdf_path: Option<String>,
    /// Abstract.
    #[serde(rename = "abstract", default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub abstract_text: Option<String>,
    /// The reader's summary.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub summary: Option<String>,
    /// Reading status.
    pub status: PaperStatus,
    /// Rating, 1 to 5.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub rating: Option<f64>,
    /// When the paper was read.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub read_at: Option<String>,
    /// BibTeX entry.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub bibtex: Option<String>,
    /// Keyword tags.
    #[serde(default)]
    pub tags: Vec<String>,
    /// Extensible bag for anything not modeled explicitly.
    #[serde(default)]
    #[cfg_attr(
        feature = "specta",
        specta(type = std::collections::BTreeMap<String, specta_typescript::Unknown>)
    )]
    pub metadata: Map<String, Value>,
    /// Import time (ISO 8601).
    pub created_at: String,
    /// Last update time (ISO 8601).
    pub updated_at: String,
}

/// Progress order of a status: the further along, the larger.
fn status_progress(status: PaperStatus) -> u8 {
    match status {
        PaperStatus::ToRead => 0,
        PaperStatus::Skimmed => 1,
        PaperStatus::Reading => 2,
        PaperStatus::Read => 3,
    }
}

/// Identity of a list entry: an annotation's `key`, or the value itself.
fn entry_key(entry: &Value) -> String {
    match entry
        .as_object()
        .and_then(|object| object.get("key"))
        .and_then(Value::as_str)
    {
        Some(key) => format!("k:{key}"),
        None => format!("v:{entry}"),
    }
}

/// Two lists as one, first-seen order, no entry twice (annotations by key).
fn union_list(a: &[Value], b: &[Value]) -> Vec<Value> {
    let mut seen = HashSet::new();
    a.iter()
        .chain(b)
        .filter(|entry| seen.insert(entry_key(entry)))
        .cloned()
        .collect()
}

/// The kept paper with what the duplicate knew and it did not.
///
/// Nothing the kept copy has is overwritten: a gap is filled, tags and metadata keys are
/// unioned (list-valued ones such as cached annotations and figure images are joined, so
/// pins on the duplicate's annotations still point at something), the status and rating
/// are the further along of the two, and two different summaries are both kept. The
/// duplicate's id is recorded under `metadata.mergedFrom`, so a merge can be traced.
#[must_use]
#[allow(clippy::too_many_lines, reason = "mirrors the TS function for parity")]
pub fn merge_paper_into(keep: &MergePaper, dup: &MergePaper) -> MergePaper {
    let title =
        if is_placeholder_title(Some(&keep.title)) && !is_placeholder_title(Some(&dup.title)) {
            dup.title.clone()
        } else {
            keep.title.clone()
        };

    let summaries: Vec<String> = [keep.summary.as_deref(), dup.summary.as_deref()]
        .into_iter()
        .flatten()
        .map(str::trim)
        .filter(|summary| !summary.is_empty())
        .map(str::to_owned)
        .collect();
    let summary = match summaries.as_slice() {
        [first, second] if first != second => Some(format!("{first}\n\n{second}")),
        [first, ..] => Some(first.clone()),
        [] => None,
    };

    let mut metadata = keep.metadata.clone();
    for (key, value) in &dup.metadata {
        if OWN_METADATA.contains(&key.as_str()) {
            continue;
        }
        let merged = match (metadata.get(key), value) {
            (None, _) => Some(value.clone()),
            (Some(Value::Array(kept)), Value::Array(extra)) => {
                Some(Value::Array(union_list(kept, extra)))
            }
            _ => None,
        };
        if let Some(merged) = merged {
            let _ = metadata.insert(key.clone(), merged);
        }
    }
    let previous: Vec<Value> = match keep.metadata.get("mergedFrom") {
        Some(Value::Array(list)) => list.clone(),
        _ => Vec::new(),
    };
    let dup_id = Value::String(dup.id.clone());
    let mut merged_from: Vec<Value> = previous.into_iter().filter(|x| *x != dup_id).collect();
    merged_from.push(dup_id);
    let _ = metadata.insert("mergedFrom".to_owned(), Value::Array(merged_from));

    let top_rating = keep.rating.unwrap_or(0.0).max(dup.rating.unwrap_or(0.0));
    let status = if status_progress(dup.status) > status_progress(keep.status) {
        dup.status
    } else {
        keep.status
    };

    MergePaper {
        id: keep.id.clone(),
        title,
        authors: if keep.authors.is_empty() {
            dup.authors.clone()
        } else {
            keep.authors.clone()
        },
        year: keep.year.or(dup.year),
        venue: keep.venue.clone().or_else(|| dup.venue.clone()),
        doi: keep.doi.clone().or_else(|| dup.doi.clone()),
        arxiv_id: keep.arxiv_id.clone().or_else(|| dup.arxiv_id.clone()),
        url: keep.url.clone().or_else(|| dup.url.clone()),
        pdf_path: keep.pdf_path.clone().or_else(|| dup.pdf_path.clone()),
        abstract_text: keep
            .abstract_text
            .clone()
            .or_else(|| dup.abstract_text.clone()),
        summary,
        status,
        rating: (top_rating != 0.0).then_some(top_rating),
        read_at: keep.read_at.clone().or_else(|| dup.read_at.clone()),
        bibtex: keep.bibtex.clone().or_else(|| dup.bibtex.clone()),
        tags: normalize_tags(&[keep.tags.as_slice(), dup.tags.as_slice()].concat()),
        metadata,
        created_at: keep.created_at.clone(),
        updated_at: keep.updated_at.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn paper(id: &str, title: &str) -> MergePaper {
        MergePaper {
            id: id.to_owned(),
            title: title.to_owned(),
            authors: Vec::new(),
            year: None,
            venue: None,
            doi: None,
            arxiv_id: None,
            url: None,
            pdf_path: None,
            abstract_text: None,
            summary: None,
            status: PaperStatus::ToRead,
            rating: None,
            read_at: None,
            bibtex: None,
            tags: Vec::new(),
            metadata: Map::new(),
            created_at: "2026-01-02T00:00:00Z".to_owned(),
            updated_at: "2026-01-01T00:00:00Z".to_owned(),
        }
    }

    #[allow(
        clippy::needless_pass_by_value,
        reason = "test helper; five call sites take json! literals by value"
    )]
    fn meta(value: Value) -> Map<String, Value> {
        value.as_object().cloned().unwrap_or_default()
    }

    #[test]
    fn a_merge_fills_gaps_and_unions_and_records_where_it_came_from() {
        let mut keep = paper("k", "Catalog Page");
        keep.authors = vec!["Ada".to_owned()];
        keep.summary = Some("Mine.".to_owned());
        keep.status = PaperStatus::Skimmed;
        keep.rating = Some(3.0);
        keep.tags = vec!["ml".to_owned()];
        keep.metadata = meta(json!({ "zoteroKey": "KEEP", "note": "kept" }));
        let mut dup = paper("d", "Real Title of the Paper");
        dup.authors = vec!["Someone Else".to_owned()];
        dup.doi = Some("10.1/x".to_owned());
        dup.pdf_path = Some("d.pdf".to_owned());
        dup.summary = Some("Theirs.".to_owned());
        dup.status = PaperStatus::Read;
        dup.rating = Some(5.0);
        dup.tags = vec!["ML".to_owned(), "vision".to_owned()];
        dup.metadata = meta(json!({ "zoteroKey": "DUP", "note": "dup", "extra": 1 }));

        let merged = merge_paper_into(&keep, &dup);
        assert_eq!(merged.id, "k");
        assert_eq!(merged.title, "Real Title of the Paper");
        assert_eq!(merged.authors, vec!["Ada".to_owned()]);
        assert_eq!(merged.doi.as_deref(), Some("10.1/x"));
        assert_eq!(merged.pdf_path.as_deref(), Some("d.pdf"));
        assert_eq!(merged.summary.as_deref(), Some("Mine.\n\nTheirs."));
        assert_eq!(merged.status, PaperStatus::Read);
        assert_eq!(merged.rating, Some(5.0));
        let mut tags = merged.tags.clone();
        tags.sort();
        assert_eq!(tags, vec!["ml".to_owned(), "vision".to_owned()]);
        assert_eq!(merged.metadata["zoteroKey"], json!("KEEP"));
        assert_eq!(merged.metadata["note"], json!("kept"));
        assert_eq!(merged.metadata["extra"], json!(1));
        assert_eq!(merged.metadata["mergedFrom"], json!(["d"]));
    }

    #[test]
    fn the_same_summary_twice_is_kept_once_and_a_second_merge_appends_to_merged_from() {
        let mut keep = paper("k", "A sufficiently long distinct paper title 2");
        keep.summary = Some("Same.".to_owned());
        keep.metadata = meta(json!({ "mergedFrom": ["x"] }));
        let mut dup = paper("d", "A sufficiently long distinct paper title 3");
        dup.summary = Some(" Same. ".to_owned());

        let merged = merge_paper_into(&keep, &dup);
        assert_eq!(merged.summary.as_deref(), Some("Same."));
        assert_eq!(merged.metadata["mergedFrom"], json!(["x", "d"]));
    }

    #[test]
    fn list_valued_metadata_is_joined_annotations_by_key_images_by_value() {
        let mut keep = paper("k", "A sufficiently long distinct paper title 4");
        keep.metadata = meta(json!({
            "annotations": [{ "key": "A", "text": "1" }],
            "images": ["a.png"],
        }));
        let mut dup = paper("d", "A sufficiently long distinct paper title 5");
        dup.metadata = meta(json!({
            "annotations": [{ "key": "A", "text": "stale" }, { "key": "B" }],
            "images": ["a.png", "b.png"],
        }));

        let merged = merge_paper_into(&keep, &dup);
        assert_eq!(
            merged.metadata["annotations"],
            json!([{ "key": "A", "text": "1" }, { "key": "B" }])
        );
        assert_eq!(merged.metadata["images"], json!(["a.png", "b.png"]));
    }
}
