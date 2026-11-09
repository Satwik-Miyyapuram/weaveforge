//! Reverse links from reader annotations to report sections (via pins) and vault
//! pages (via body text). A port of `apps/web/src/features/reader/application/annotation-backlinks.ts`.
//!
//! Stays in TS: the React hook that feeds the input and renders the hits.

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::search::js_text::{is_js_whitespace, utf16_len};

/// Shortest highlighted quote, in UTF-16 units, that may be matched in vault bodies.
const MIN_QUOTE_UTF16: usize = 12;

/// The annotation fields the scan reads (TS `Pick<ReaderAnnotation, "id" | "zoteroKey" | "text">`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct BacklinkAnnotation {
    /// The annotation's id.
    pub id: String,
    /// The Zotero key. Absent or blank, the id stands in for it.
    pub zotero_key: Option<String>,
    /// The highlighted text, matched against vault bodies when long enough.
    pub text: String,
}

/// A pin tying an annotation key to a report section (TS pin row, the fields the scan reads).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct BacklinkPin {
    /// The annotation key the pin is for.
    pub annotation_key: String,
    /// The report section it is pinned to.
    pub report_section_id: String,
}

/// A report section a pin can point at.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct BacklinkSection {
    /// The section id.
    pub id: String,
    /// The section title, shown in the backlink list.
    pub title: String,
}

/// A vault page that may quote an annotation.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct BacklinkVaultPage {
    /// The page id.
    pub id: String,
    /// The page title, shown in the backlink list.
    pub title: String,
    /// The page body. Absent counts as empty.
    pub body: Option<String>,
}

/// Everything the backlink scan reads (TS `findAnnotationBacklinks` input).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct BacklinkInput {
    /// The annotations to scan.
    pub annotations: Vec<BacklinkAnnotation>,
    /// The pins, in the order they were made.
    pub pins: Vec<BacklinkPin>,
    /// The report sections the pins may point at.
    pub sections: Vec<BacklinkSection>,
    /// The vault pages that may cite the annotations.
    pub vault_pages: Vec<BacklinkVaultPage>,
}

/// Where a backlink points (TS `AnnotationBacklinkTarget.kind`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "snake_case")]
pub enum AnnotationBacklinkKind {
    /// A report section, reached through a pin.
    ReportSection,
    /// A vault page whose body names the annotation.
    VaultPage,
}

/// One thing that links back to an annotation (TS `AnnotationBacklinkTarget`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct AnnotationBacklinkTarget {
    /// Whether this is a report section or a vault page.
    pub kind: AnnotationBacklinkKind,
    /// The section or page id.
    pub id: String,
    /// The section or page title.
    pub title: String,
}

/// The backlinks for one annotation (TS `AnnotationBacklinkHit`). Only annotations with targets appear.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct AnnotationBacklinkHit {
    /// The annotation's id.
    pub annotation_id: String,
    /// The key used to find it: the trimmed Zotero key, or the id.
    pub annotation_key: String,
    /// The sections and pages that link to it, sections first.
    pub targets: Vec<AnnotationBacklinkTarget>,
}

/// Trims with JS `String.prototype.trim` rules, not Rust's.
fn trim_js(text: &str) -> &str {
    text.trim_matches(is_js_whitespace)
}

/// The key an annotation is found by: its trimmed Zotero key, else its id (TS `ann.zoteroKey?.trim() || ann.id`).
fn annotation_key(annotation: &BacklinkAnnotation) -> &str {
    annotation
        .zotero_key
        .as_deref()
        .map(trim_js)
        .filter(|key| !key.is_empty())
        .unwrap_or(&annotation.id)
}

/// Reverse links from annotations to report sections and vault pages (TS `findAnnotationBacklinks`).
///
/// A section is linked when a pin names it for the annotation's key. A page is linked when its
/// body contains the key, or the trimmed quote when the quote is at least 12 UTF-16 units long.
#[must_use]
pub fn find_annotation_backlinks(input: &BacklinkInput) -> Vec<AnnotationBacklinkHit> {
    let section_by_id: HashMap<&str, &BacklinkSection> = input
        .sections
        .iter()
        .map(|section| (section.id.as_str(), section))
        .collect();
    let mut sections_by_key: HashMap<&str, Vec<&str>> = HashMap::new();
    for pin in &input.pins {
        sections_by_key
            .entry(pin.annotation_key.as_str())
            .or_default()
            .push(pin.report_section_id.as_str());
    }

    let mut hits = Vec::new();
    for annotation in &input.annotations {
        let key = annotation_key(annotation);
        let quote = trim_js(&annotation.text);
        let mut targets = Vec::new();
        let mut seen_sections: HashSet<&str> = HashSet::new();
        let mut seen_pages: HashSet<&str> = HashSet::new();

        for section_id in sections_by_key.get(key).into_iter().flatten() {
            let Some(section) = section_by_id.get(section_id) else {
                continue;
            };
            if !seen_sections.insert(section.id.as_str()) {
                continue;
            }
            targets.push(AnnotationBacklinkTarget {
                kind: AnnotationBacklinkKind::ReportSection,
                id: section.id.clone(),
                title: section.title.clone(),
            });
        }

        for page in &input.vault_pages {
            let body = page.body.as_deref().unwrap_or("");
            let mentions_key = body.contains(key);
            let mentions_quote = utf16_len(quote) >= MIN_QUOTE_UTF16 && body.contains(quote);
            if !mentions_key && !mentions_quote {
                continue;
            }
            if !seen_pages.insert(page.id.as_str()) {
                continue;
            }
            targets.push(AnnotationBacklinkTarget {
                kind: AnnotationBacklinkKind::VaultPage,
                id: page.id.clone(),
                title: page.title.clone(),
            });
        }

        if !targets.is_empty() {
            hits.push(AnnotationBacklinkHit {
                annotation_id: annotation.id.clone(),
                annotation_key: key.to_owned(),
                targets,
            });
        }
    }
    hits
}

/// The targets of the first hit for `annotation_id`, or none (TS `backlinksForAnnotation`).
#[must_use]
pub fn backlinks_for_annotation<'a>(
    hits: &'a [AnnotationBacklinkHit],
    annotation_id: &str,
) -> &'a [AnnotationBacklinkTarget] {
    hits.iter()
        .find(|hit| hit.annotation_id == annotation_id)
        .map_or(&[], |hit| hit.targets.as_slice())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn annotation(id: &str, zotero_key: Option<&str>, text: &str) -> BacklinkAnnotation {
        BacklinkAnnotation {
            id: id.to_owned(),
            zotero_key: zotero_key.map(str::to_owned),
            text: text.to_owned(),
        }
    }

    fn page(id: &str, title: &str, body: &str) -> BacklinkVaultPage {
        BacklinkVaultPage {
            id: id.to_owned(),
            title: title.to_owned(),
            body: Some(body.to_owned()),
        }
    }

    #[test]
    fn links_pins_and_vault_mentions() {
        let input = BacklinkInput {
            annotations: vec![
                annotation("local-1", None, "unique quote here about methods"),
                annotation("z-1", Some("ABCD"), "other"),
            ],
            pins: vec![BacklinkPin {
                annotation_key: "local-1".to_owned(),
                report_section_id: "sec-1".to_owned(),
            }],
            sections: vec![BacklinkSection {
                id: "sec-1".to_owned(),
                title: "Methods".to_owned(),
            }],
            vault_pages: vec![
                page("n1", "Note", "See ABCD in the lit review."),
                page(
                    "n2",
                    "Quote note",
                    "unique quote here about methods was useful.",
                ),
            ],
        };
        let hits = find_annotation_backlinks(&input);
        assert_eq!(hits.len(), 2);
        let local = hits.iter().find(|h| h.annotation_id == "local-1").unwrap();
        let kinds: Vec<AnnotationBacklinkKind> = local.targets.iter().map(|t| t.kind).collect();
        assert_eq!(
            kinds,
            vec![
                AnnotationBacklinkKind::ReportSection,
                AnnotationBacklinkKind::VaultPage
            ]
        );
        assert_eq!(backlinks_for_annotation(&hits, "z-1")[0].id, "n1");
    }

    #[test]
    fn returns_empty_when_nothing_cites() {
        let input = BacklinkInput {
            annotations: vec![annotation("a", None, "short")],
            pins: vec![],
            sections: vec![],
            vault_pages: vec![],
        };
        assert!(find_annotation_backlinks(&input).is_empty());
        assert!(backlinks_for_annotation(&[], "a").is_empty());
    }

    #[test]
    fn blank_zotero_key_falls_back_to_the_id() {
        let input = BacklinkInput {
            annotations: vec![annotation("local-9", Some("   "), "short")],
            pins: vec![],
            sections: vec![],
            vault_pages: vec![page("n1", "Note", "cites local-9 here")],
        };
        let hits = find_annotation_backlinks(&input);
        assert_eq!(hits[0].annotation_key, "local-9");
    }

    #[test]
    fn short_quotes_do_not_match_by_text() {
        let input = BacklinkInput {
            annotations: vec![annotation("zz-1", None, "eleven char")],
            pins: vec![],
            sections: vec![],
            vault_pages: vec![page("n1", "Note", "the eleven char phrase")],
        };
        assert!(find_annotation_backlinks(&input).is_empty());
    }

    #[test]
    fn pins_to_unknown_sections_are_skipped() {
        let input = BacklinkInput {
            annotations: vec![annotation("a", None, "x")],
            pins: vec![BacklinkPin {
                annotation_key: "a".to_owned(),
                report_section_id: "gone".to_owned(),
            }],
            sections: vec![],
            vault_pages: vec![],
        };
        assert!(find_annotation_backlinks(&input).is_empty());
    }
}
