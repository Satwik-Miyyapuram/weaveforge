//! Which papers a pulled bibliography-annotation set changes, and the summary
//! (tag) merge for each. Ported from
//! `apps/web/src/integrations/providers/zotero/apply-bibliography-annotations.ts`.
//!
//! The caller does the reads, the saves and the tag reconcile; this only decides.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::papers::note_tags::append_tag_hashtags;
use crate::papers::paper::extract_hashtags;

/// Annotation kind whose tags and hashtags are not merged into the summary.
const NOTE_KIND: &str = "note";

/// One paper as the merge sees it. `zotero_key` and `recorded_attachment_key`
/// are the paper's metadata values, passed only when they are strings.
#[derive(Debug, Clone, Default, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[cfg_attr(feature = "specta", serde(rename = "BibliographyPaperInput"))]
#[serde(rename_all = "camelCase", default)]
pub struct PaperForPull {
    /// The paper's id.
    pub id: String,
    /// The paper's summary body.
    #[cfg_attr(feature = "specta", specta(optional))]
    pub summary: Option<String>,
    /// The paper's Zotero item key, when it has one.
    #[cfg_attr(feature = "specta", specta(optional))]
    pub zotero_key: Option<String>,
    /// The attachment key already recorded on the paper.
    #[cfg_attr(feature = "specta", specta(optional))]
    pub recorded_attachment_key: Option<String>,
    /// Length of the cached `annotations` array (0 when absent or not an array).
    #[cfg_attr(feature = "specta", specta(type = u32))]
    pub cached_annotation_count: usize,
}

/// The fields of one pulled annotation the merge reads.
#[derive(Debug, Clone, Default, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[cfg_attr(feature = "specta", serde(rename = "BibliographyTagSource"))]
#[serde(rename_all = "camelCase", default)]
pub struct AnnotationTagSource {
    /// The annotation kind.
    #[cfg_attr(feature = "specta", specta(optional))]
    pub kind: Option<String>,
    /// Its tags.
    pub tags: Vec<String>,
    /// Its comment.
    #[cfg_attr(feature = "specta", specta(optional))]
    pub comment: Option<String>,
    /// Its highlighted text.
    #[cfg_attr(feature = "specta", specta(optional))]
    pub text: Option<String>,
}

/// A pull, keyed by Zotero item key.
#[derive(Debug, Clone, Default, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[cfg_attr(feature = "specta", serde(rename = "BibliographyPullInput"))]
#[serde(rename_all = "camelCase", default)]
pub struct BibliographyPull {
    /// The pulled annotations per Zotero item key.
    pub by_paper: BTreeMap<String, Vec<AnnotationTagSource>>,
    /// The attachment key per Zotero item key.
    pub attachments: BTreeMap<String, String>,
}

/// What to do for one paper the pull touches.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[cfg_attr(feature = "specta", serde(rename = "BibliographyPaperPlan"))]
#[serde(rename_all = "camelCase")]
pub struct PaperPlan {
    /// The paper's id.
    pub id: String,
    /// The paper's Zotero item key.
    pub zotero_key: String,
    /// The summary to save (tags appended when annotations exist).
    pub summary: Option<String>,
    /// True when the pull covered the paper: its annotations are replaced
    /// (an empty set clears them).
    pub covered: bool,
    /// The attachment key to record, when there is one.
    pub attachment_key: Option<String>,
    /// How many annotations the pull holds for the paper.
    #[cfg_attr(feature = "specta", specta(type = u32))]
    pub annotation_count: usize,
    /// True when the tag index should be reconciled from the summary body.
    pub reconcile_tags: bool,
}

/// Plan the merge for every paper the pull changes, in input order. Papers
/// the pull did not cover and that have nothing new are left out.
#[must_use]
pub fn plan_bibliography_annotations(
    papers: &[PaperForPull],
    pull: &BibliographyPull,
) -> Vec<PaperPlan> {
    papers
        .iter()
        .filter_map(|paper| plan_one(paper, pull))
        .collect()
}

fn plan_one(paper: &PaperForPull, pull: &BibliographyPull) -> Option<PaperPlan> {
    let zotero_key = paper.zotero_key.as_deref().filter(|key| !key.is_empty())?;
    let anns: &[AnnotationTagSource] = pull
        .by_paper
        .get(zotero_key)
        .map(Vec::as_slice)
        .unwrap_or(&[]);
    let attachment_key = pull
        .attachments
        .get(zotero_key)
        .filter(|key| !key.is_empty());
    let attachment_changed = attachment_key
        .is_some_and(|key| paper.recorded_attachment_key.as_deref() != Some(key.as_str()));
    let covered =
        pull.by_paper.contains_key(zotero_key) || pull.attachments.contains_key(zotero_key);
    let had_cached = paper.cached_annotation_count > 0;
    if anns.is_empty() && !(covered && had_cached) && !attachment_changed {
        return None;
    }

    let summary = if anns.is_empty() {
        paper.summary.clone()
    } else {
        let tag_names: Vec<String> = anns
            .iter()
            .filter(|ann| ann.kind.as_deref() != Some(NOTE_KIND))
            .flat_map(|ann| {
                ann.tags
                    .iter()
                    .cloned()
                    .chain(extract_hashtags(ann.comment.as_deref()))
                    .chain(extract_hashtags(ann.text.as_deref()))
            })
            .collect();
        let merged = append_tag_hashtags(paper.summary.as_deref().unwrap_or(""), &tag_names);
        if merged.is_empty() {
            None
        } else {
            Some(merged)
        }
    };

    Some(PaperPlan {
        id: paper.id.clone(),
        zotero_key: zotero_key.to_string(),
        summary,
        covered,
        attachment_key: attachment_key.cloned(),
        annotation_count: anns.len(),
        reconcile_tags: !anns.is_empty(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn paper(zotero_key: Option<&str>) -> PaperForPull {
        PaperForPull {
            id: "p1".to_string(),
            summary: None,
            zotero_key: zotero_key.map(str::to_string),
            recorded_attachment_key: None,
            cached_annotation_count: 0,
        }
    }

    fn pull(
        by_paper: &[(&str, Vec<AnnotationTagSource>)],
        attachments: &[(&str, &str)],
    ) -> BibliographyPull {
        BibliographyPull {
            by_paper: by_paper
                .iter()
                .map(|(k, v)| ((*k).to_string(), v.clone()))
                .collect(),
            attachments: attachments
                .iter()
                .map(|(k, v)| ((*k).to_string(), (*v).to_string()))
                .collect(),
        }
    }

    #[test]
    fn uncovered_paper_is_left_out() {
        let plans = plan_bibliography_annotations(&[paper(Some("ELSEWHERE"))], &pull(&[], &[]));
        assert!(plans.is_empty());
    }

    #[test]
    fn paper_without_zotero_key_is_left_out() {
        let plans = plan_bibliography_annotations(
            &[paper(None), paper(Some(""))],
            &pull(&[("", vec![AnnotationTagSource::default()])], &[]),
        );
        assert!(plans.is_empty());
    }

    #[test]
    fn attachment_is_recorded_with_no_annotations_yet() {
        let plans =
            plan_bibliography_annotations(&[paper(Some("PAPER"))], &pull(&[], &[("PAPER", "ATT")]));
        assert_eq!(plans.len(), 1);
        assert_eq!(plans[0].attachment_key.as_deref(), Some("ATT"));
        assert!(plans[0].covered);
        assert_eq!(plans[0].annotation_count, 0);
        assert!(!plans[0].reconcile_tags);
    }

    #[test]
    fn deleted_highlight_clears_cached_annotations() {
        let mut p = paper(Some("PAPER"));
        p.recorded_attachment_key = Some("ATT".to_string());
        p.cached_annotation_count = 1;
        let plans = plan_bibliography_annotations(&[p], &pull(&[], &[("PAPER", "ATT")]));
        assert_eq!(plans.len(), 1);
        assert!(plans[0].covered);
        assert_eq!(plans[0].annotation_count, 0);
        assert_eq!(plans[0].attachment_key, Some("ATT".to_string()));
    }

    #[test]
    fn unchanged_attachment_with_no_cache_is_left_out() {
        let mut p = paper(Some("PAPER"));
        p.recorded_attachment_key = Some("ATT".to_string());
        let plans = plan_bibliography_annotations(&[p], &pull(&[], &[("PAPER", "ATT")]));
        // Covered but nothing cached and the attachment already recorded: no write.
        assert!(plans.is_empty());
    }

    #[test]
    fn annotation_tags_and_hashtags_merge_into_summary() {
        let ann = AnnotationTagSource {
            kind: Some("annotation".to_string()),
            tags: vec!["Method".to_string()],
            comment: Some("see #idea".to_string()),
            text: None,
        };
        let mut p = paper(Some("PAPER"));
        p.summary = Some("Body".to_string());
        let plans = plan_bibliography_annotations(&[p], &pull(&[("PAPER", vec![ann])], &[]));
        assert_eq!(plans.len(), 1);
        let expected = append_tag_hashtags("Body", &["Method".to_string(), "idea".to_string()]);
        assert_eq!(plans[0].summary.as_deref(), Some(expected.as_str()));
        assert_eq!(plans[0].annotation_count, 1);
        assert!(plans[0].reconcile_tags);
    }

    #[test]
    fn note_kind_contributes_no_tags() {
        let note = AnnotationTagSource {
            kind: Some("note".to_string()),
            tags: vec!["Ignored".to_string()],
            comment: Some("#ignored".to_string()),
            text: None,
        };
        let mut p = paper(Some("PAPER"));
        p.summary = Some("Body".to_string());
        let plans = plan_bibliography_annotations(&[p], &pull(&[("PAPER", vec![note])], &[]));
        assert_eq!(plans[0].summary.as_deref(), Some("Body"));
        assert_eq!(plans[0].annotation_count, 1);
    }

    #[test]
    fn empty_summary_with_no_tags_stays_none() {
        let ann = AnnotationTagSource {
            kind: None,
            tags: vec![],
            comment: None,
            text: Some("plain".to_string()),
        };
        let plans = plan_bibliography_annotations(
            &[paper(Some("PAPER"))],
            &pull(&[("PAPER", vec![ann])], &[]),
        );
        assert_eq!(plans[0].summary, None);
    }
}
