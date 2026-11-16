//! Zotero annotation and note rows, one raw item at a time (TS `zotero-annotations.ts`).
//!
//! Fetching and the attachment-to-paper join stay in TS. These functions only read
//! one item's fields and reshape them, so a malformed field degrades to `None`
//! instead of failing the whole pull.

use std::sync::LazyLock;

use regex_lite::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::papers::js_regex::compile;
use crate::reader::zotero_sync::ZoteroAnnotationType;
use crate::search::js_text::is_js_whitespace;

/// A Zotero item as the local or cloud API returns it. Only the fields read here are kept.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ZoteroItemRow {
    /// The key at the top of the item.
    pub key: Option<String>,
    /// The item's fields. The local API may put the key here instead.
    pub data: Option<ZoteroItemData>,
}

/// The `data` object of a Zotero item.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ZoteroItemData {
    /// The local API can give the key here instead of at the top.
    pub key: Option<String>,
    /// Parent item.
    pub parent_item: Option<String>,
    /// Content type.
    pub content_type: Option<String>,
    /// Title.
    pub title: Option<String>,
    /// Filename.
    pub filename: Option<String>,
    /// A linked file's path, which may be the only sign it is a PDF.
    pub path: Option<String>,
    /// Annotation text.
    pub annotation_text: Option<String>,
    /// Annotation comment.
    pub annotation_comment: Option<String>,
    /// Annotation color.
    pub annotation_color: Option<String>,
    /// Annotation page label.
    pub annotation_page_label: Option<String>,
    /// Annotation type.
    pub annotation_type: Option<String>,
    /// JSON string, e.g. `{"pageIndex":24,"rects":[[x1,y1,x2,y2]]}`.
    pub annotation_position: Option<String>,
    /// Annotation sort index.
    pub annotation_sort_index: Option<String>,
    /// A note's HTML fragment.
    pub note: Option<String>,
    /// Tags.
    pub tags: Option<Vec<ZoteroTagRow>>,
}

/// One entry of a Zotero item's `tags` array.
#[derive(Debug, Clone, Default, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ZoteroTagRow {
    /// Tag.
    pub tag: Option<String>,
}

/// Whether a row is a highlight-like annotation or a note (TS `ZoteroAnnotation.kind`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub enum ZoteroAnnotationKind {
    /// Annotation.
    Annotation,
    /// Note.
    Note,
}

/// Zotero's `annotationPosition` (TS `ZoteroAnnotationPosition`).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ZoteroAnnotationPosition {
    /// Page index.
    pub page_index: f64,
    /// `[x1, y1, x2, y2]` per line box, on `page_index`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rects: Option<Vec<Vec<f64>>>,
    /// Tail of a highlight that crosses a page break, on `page_index + 1`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_page_rects: Option<Vec<Vec<f64>>>,
    /// Ink strokes as flat point lists.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub paths: Option<Vec<Vec<f64>>>,
}

/// A Zotero annotation or note as the app caches it (TS `ZoteroAnnotation`).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ZoteroAnnotation {
    #[serde(skip_serializing_if = "Option::is_none")]
    /// Key.
    pub key: Option<String>,
    /// Kind.
    pub kind: ZoteroAnnotationKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    /// Text.
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    /// Comment.
    pub comment: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    /// Color.
    pub color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    /// Page.
    pub page: Option<String>,
    /// Tags.
    pub tags: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    /// Annotation type.
    pub annotation_type: Option<ZoteroAnnotationType>,
    #[serde(skip_serializing_if = "Option::is_none")]
    /// Annotation position.
    pub annotation_position: Option<ZoteroAnnotationPosition>,
    #[serde(skip_serializing_if = "Option::is_none")]
    /// Annotation sort index.
    pub annotation_sort_index: Option<String>,
}

/// The item's key, from the top level or from `data` (TS `itemKey`).
#[must_use]
pub fn item_key(item: &ZoteroItemRow) -> Option<String> {
    field(item.data.as_ref(), |d| d.key.as_deref()).or_else(|| non_empty(item.key.as_deref()))
}

/// Whether an attachment is a PDF, by content type or by file name.
#[must_use]
pub fn is_pdf_attachment(item: &ZoteroItemRow) -> bool {
    let Some(d) = item.data.as_ref() else {
        return false;
    };
    if d.content_type
        .as_deref()
        .is_some_and(|c| c.to_lowercase().contains("pdf"))
    {
        return true;
    }
    file_name(d).to_ascii_lowercase().ends_with(".pdf")
}

static SUPPLEMENT_RE: LazyLock<Option<Regex>> =
    LazyLock::new(|| compile(r"(?i)supplement|appendix|supporting|rebuttal|response").ok());
static FULL_TEXT_RE: LazyLock<Option<Regex>> =
    LazyLock::new(|| compile(r"(?i)full\s*text|preprint|accepted|submitted|manuscript").ok());

/// How likely an attachment is the paper itself rather than a supplement (0 to 2).
#[must_use]
pub fn main_pdf_score(item: &ZoteroItemRow) -> u8 {
    let d = item.data.as_ref();
    let title = d.and_then(|d| d.title.as_deref()).unwrap_or("");
    let name = format!("{title} {}", d.map_or("", file_name));
    if is_match(&SUPPLEMENT_RE, &name) {
        0
    } else if is_match(&FULL_TEXT_RE, &name) {
        2
    } else {
        1
    }
}

/// The paper's main PDF key: best score first, then key, so every run agrees.
#[must_use]
pub fn pick_main_pdf(pdfs: &[ZoteroItemRow]) -> Option<String> {
    let mut ranked: Vec<&ZoteroItemRow> = pdfs.iter().collect();
    ranked.sort_by(|a, b| {
        main_pdf_score(b).cmp(&main_pdf_score(a)).then_with(|| {
            item_key(a)
                .unwrap_or_default()
                .cmp(&item_key(b).unwrap_or_default())
        })
    });
    ranked.first().and_then(|it| item_key(it))
}

/// Parses Zotero's `annotationPosition` JSON. Absent, empty or malformed input is `None`.
///
/// Malformed coordinate rows are dropped rather than propagated. `paths` need two
/// numbers per point and `rects` need four.
#[must_use]
pub fn parse_annotation_position(raw: Option<&str>) -> Option<ZoteroAnnotationPosition> {
    let raw = raw?;
    if raw.trim_matches(is_js_whitespace).is_empty() {
        return None;
    }
    let Value::Object(map) = serde_json::from_str::<Value>(raw).ok()? else {
        return None;
    };
    let page_index = map.get("pageIndex").and_then(finite)?;
    Some(ZoteroAnnotationPosition {
        page_index,
        rects: number_arrays(map.get("rects"), 4),
        next_page_rects: number_arrays(map.get("nextPageRects"), 4),
        paths: number_arrays(map.get("paths"), 2),
    })
}

/// Maps a Zotero annotation type name, or `None` when it is not one Zotero defines.
#[must_use]
pub fn parse_annotation_type(raw: Option<&str>) -> Option<ZoteroAnnotationType> {
    Some(match raw? {
        "highlight" => ZoteroAnnotationType::Highlight,
        "underline" => ZoteroAnnotationType::Underline,
        "note" => ZoteroAnnotationType::Note,
        "image" => ZoteroAnnotationType::Image,
        "ink" => ZoteroAnnotationType::Ink,
        "text" => ZoteroAnnotationType::Text,
        _ => return None,
    })
}

/// (pattern, replacement) pairs turning a note's HTML into plain text, in order.
const HTML_RULES_SRC: &[(&str, &str)] = &[
    (r"(?i)<br\s*/?\s*>", "\n"),
    (r"(?i)</p\s*>", "\n"),
    (r"<[^>]*>", ""),
    (r"(?i)&nbsp;", " "),
    (r"(?i)&amp;", "&"),
    (r"(?i)&lt;", "<"),
    (r"(?i)&gt;", ">"),
    (r"(?i)&quot;", "\""),
    (r"&#39;", "'"),
    (r"\n{3,}", "\n\n"),
];

static HTML_RULES: LazyLock<Vec<(Regex, &'static str)>> = LazyLock::new(|| {
    HTML_RULES_SRC
        .iter()
        .filter_map(|(pattern, rep)| compile(pattern).ok().map(|re| (re, *rep)))
        .collect()
});

/// A note's HTML as plain text, or `None` when nothing is left (TS `toPlainText`).
#[must_use]
pub fn to_plain_text(note: Option<&str>) -> Option<String> {
    let note = note.filter(|n| !n.is_empty())?;
    let mut text = note.to_owned();
    for (re, rep) in HTML_RULES.iter() {
        text = re.replace_all(&text, *rep).into_owned();
    }
    let trimmed = text.trim_matches(is_js_whitespace);
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_owned())
    }
}

/// An annotation row as the app caches it (TS annotation branch of `pull`).
#[must_use]
pub fn annotation_from_item(item: &ZoteroItemRow) -> ZoteroAnnotation {
    let d = item.data.as_ref();
    ZoteroAnnotation {
        key: item_key(item),
        kind: ZoteroAnnotationKind::Annotation,
        text: field(d, |d| d.annotation_text.as_deref()),
        comment: field(d, |d| d.annotation_comment.as_deref()),
        color: field(d, |d| d.annotation_color.as_deref()),
        page: field(d, |d| d.annotation_page_label.as_deref()),
        tags: tag_names(d),
        annotation_type: parse_annotation_type(d.and_then(|d| d.annotation_type.as_deref())),
        annotation_position: parse_annotation_position(
            d.and_then(|d| d.annotation_position.as_deref()),
        ),
        annotation_sort_index: field(d, |d| d.annotation_sort_index.as_deref()),
    }
}

/// A note row as the app caches it, or `None` when its plain text is empty.
#[must_use]
pub fn note_from_item(item: &ZoteroItemRow) -> Option<ZoteroAnnotation> {
    let text = to_plain_text(item.data.as_ref().and_then(|d| d.note.as_deref()))?;
    Some(ZoteroAnnotation {
        key: item_key(item),
        kind: ZoteroAnnotationKind::Note,
        text: Some(text),
        comment: None,
        color: None,
        page: None,
        tags: Vec::new(),
        annotation_type: None,
        annotation_position: None,
        annotation_sort_index: None,
    })
}

/// `Some(value)` unless it is absent or empty (JS `value || undefined`).
fn non_empty(value: Option<&str>) -> Option<String> {
    value.filter(|s| !s.is_empty()).map(str::to_owned)
}

/// A non-empty field of `d`, picked by `pick`.
fn field(d: Option<&ZoteroItemData>, pick: fn(&ZoteroItemData) -> Option<&str>) -> Option<String> {
    non_empty(d.and_then(pick))
}

/// `filename`, else `path` (JS `filename ?? path ?? ""`).
fn file_name(d: &ZoteroItemData) -> &str {
    d.filename.as_deref().or(d.path.as_deref()).unwrap_or("")
}

fn tag_names(d: Option<&ZoteroItemData>) -> Vec<String> {
    d.and_then(|d| d.tags.as_ref())
        .map(|tags| {
            tags.iter()
                .filter_map(|t| t.tag.clone())
                .filter(|t| !t.is_empty())
                .collect()
        })
        .unwrap_or_default()
}

fn is_match(re: &LazyLock<Option<Regex>>, text: &str) -> bool {
    re.as_ref().is_some_and(|re| re.is_match(text))
}

fn finite(value: &Value) -> Option<f64> {
    value.as_f64().filter(|n| n.is_finite())
}

/// JSON arrays of finite numbers, each with at least `min_len` entries. Other rows are dropped.
fn number_arrays(raw: Option<&Value>, min_len: usize) -> Option<Vec<Vec<f64>>> {
    let rows: Vec<Vec<f64>> = raw?
        .as_array()?
        .iter()
        .filter_map(|row| {
            let items = row.as_array()?;
            if items.len() < min_len {
                return None;
            }
            items.iter().map(finite).collect::<Option<Vec<f64>>>()
        })
        .collect();
    if rows.is_empty() { None } else { Some(rows) }
}

#[cfg(test)]
mod tests {
    use super::{
        HTML_RULES, HTML_RULES_SRC, ZoteroAnnotationKind, ZoteroAnnotationType, ZoteroItemRow,
        annotation_from_item, is_pdf_attachment, note_from_item, parse_annotation_position,
        pick_main_pdf, to_plain_text,
    };

    fn item(json: &str) -> ZoteroItemRow {
        serde_json::from_str(json).expect("valid item json")
    }

    #[test]
    fn position_keeps_rects_and_drops_malformed_rows() {
        let raw = r#"{"pageIndex":3,"rects":[[1,2,3,4],[1,2],["x",2,3,4]]}"#;
        let pos = parse_annotation_position(Some(raw)).expect("parses");
        assert_eq!(pos.page_index, 3.0);
        assert_eq!(pos.rects, Some(vec![vec![1.0, 2.0, 3.0, 4.0]]));
        assert_eq!(pos.paths, None);
    }

    #[test]
    fn position_without_page_index_or_valid_json_is_none() {
        assert_eq!(
            parse_annotation_position(Some(r#"{"rects":[[1,2,3,4]]}"#)),
            None
        );
        assert_eq!(parse_annotation_position(Some("  ")), None);
        assert_eq!(parse_annotation_position(Some("not json")), None);
        assert_eq!(parse_annotation_position(None), None);
    }

    #[test]
    fn position_keeps_ink_paths_and_page_break_tail() {
        let raw = r#"{"pageIndex":0,"nextPageRects":[[0,0,1,1]],"paths":[[1,2],[3,4,5,6]]}"#;
        let pos = parse_annotation_position(Some(raw)).expect("parses");
        assert_eq!(pos.next_page_rects, Some(vec![vec![0.0, 0.0, 1.0, 1.0]]));
        assert_eq!(
            pos.paths,
            Some(vec![vec![1.0, 2.0], vec![3.0, 4.0, 5.0, 6.0]])
        );
    }

    #[test]
    fn absent_geometry_is_omitted_not_null() {
        let pos = parse_annotation_position(Some(r#"{"pageIndex":1}"#)).expect("parses");
        let json = serde_json::to_value(&pos).expect("serialises");
        assert_eq!(json, serde_json::json!({ "pageIndex": 1.0 }));
    }

    #[test]
    fn annotation_type_rejects_unknown_names() {
        assert_eq!(
            super::parse_annotation_type(Some("ink")),
            Some(ZoteroAnnotationType::Ink)
        );
        assert_eq!(super::parse_annotation_type(Some("sticky")), None);
        assert_eq!(super::parse_annotation_type(None), None);
    }

    #[test]
    fn annotation_row_maps_fields_and_drops_empty_strings() {
        let row = item(
            r#"{"key":"AB12CD34","data":{"parentItem":"P1","annotationType":"ink",
            "annotationText":"","annotationComment":"c","annotationPageLabel":"4",
            "annotationPosition":"{\"pageIndex\":3,\"paths\":[[0,0,1,1]]}",
            "annotationSortIndex":"00003|000100|00000","tags":[{"tag":"x"},{"tag":""},{}]}}"#,
        );
        let ann = annotation_from_item(&row);
        assert_eq!(ann.key.as_deref(), Some("AB12CD34"));
        assert_eq!(ann.kind, ZoteroAnnotationKind::Annotation);
        assert_eq!(ann.text, None);
        assert_eq!(ann.comment.as_deref(), Some("c"));
        assert_eq!(ann.page.as_deref(), Some("4"));
        assert_eq!(ann.tags, vec!["x".to_owned()]);
        assert_eq!(ann.annotation_type, Some(ZoteroAnnotationType::Ink));
        assert_eq!(ann.annotation_position.map(|p| p.page_index), Some(3.0));
        assert_eq!(
            ann.annotation_sort_index.as_deref(),
            Some("00003|000100|00000")
        );
    }

    #[test]
    fn html_note_becomes_plain_text() {
        let row = item(
            r#"{"key":"N1","data":{"parentItem":"P1","note":"<p>Hello&nbsp;&amp; <b>bye</b></p>"}}"#,
        );
        let note = note_from_item(&row).expect("note");
        assert_eq!(note.kind, ZoteroAnnotationKind::Note);
        assert_eq!(note.text.as_deref(), Some("Hello & bye"));
        assert!(note.tags.is_empty());
    }

    #[test]
    fn plain_text_keeps_breaks_and_collapses_blank_runs() {
        assert_eq!(
            to_plain_text(Some("a<br>b</p><p>c\n\n\n\nd")).as_deref(),
            Some("a\nb\nc\n\nd")
        );
    }

    #[test]
    fn blank_note_is_none() {
        assert_eq!(to_plain_text(Some("<p> </p>")), None);
        assert_eq!(to_plain_text(Some("")), None);
        assert!(note_from_item(&item(r#"{"key":"N2","data":{"note":"<p> </p>"}}"#)).is_none());
    }

    #[test]
    fn html_rules_all_compile() {
        assert_eq!(HTML_RULES.len(), HTML_RULES_SRC.len());
    }

    #[test]
    fn main_pdf_prefers_full_text_over_supplement_then_key() {
        let supplement =
            item(r#"{"key":"AAAA0001","data":{"title":"Supplement","filename":"s.pdf"}}"#);
        let plain = item(r#"{"key":"CCCC0003","data":{"filename":"paper.pdf"}}"#);
        let full = item(r#"{"key":"BBBB0002","data":{"filename":"full text.pdf"}}"#);
        assert_eq!(
            pick_main_pdf(&[supplement, plain, full]),
            Some("BBBB0002".to_owned())
        );
        let a = item(r#"{"key":"ZZZZ0001","data":{"filename":"x.pdf"}}"#);
        let b = item(r#"{"key":"AAAA0002","data":{"filename":"y.pdf"}}"#);
        assert_eq!(pick_main_pdf(&[a, b]), Some("AAAA0002".to_owned()));
        assert_eq!(pick_main_pdf(&[]), None);
    }

    #[test]
    fn pdf_attachment_by_type_or_name() {
        assert!(is_pdf_attachment(&item(
            r#"{"data":{"contentType":"application/PDF"}}"#
        )));
        assert!(is_pdf_attachment(&item(r#"{"data":{"path":"/x/y.PDF"}}"#)));
        assert!(!is_pdf_attachment(&item(
            r#"{"data":{"filename":"a.pdf.txt"}}"#
        )));
    }
}
