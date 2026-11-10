//! Tag row mapping (TS `tag-rows.ts`). A row is a `tags` or `paper_tags` row as PostgREST and `pg`
//! return it; both backend providers read the same tables, so the mapping lives here once.

use serde::{Deserialize, Serialize};

/// A `tags` row as read with the `id, name, color` columns.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[cfg_attr(feature = "specta", serde(rename = "TagRowInput"))]
pub struct TagRow {
    /// The tag's id.
    pub id: String,
    /// The tag's display name.
    pub name: String,
    /// The tag's colour, when set.
    pub color: Option<String>,
}

/// A `paper_tags` row as read with the `paper_id, tag_id, source, annotation_ref` columns.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[cfg_attr(feature = "specta", serde(rename = "PaperTagRowInput"))]
pub struct PaperTagRow {
    /// Id of the tagged paper.
    pub paper_id: String,
    /// Id of the tag.
    pub tag_id: String,
    /// How the link was made (a `TagSource` value, carried as stored).
    pub source: String,
    /// The annotation the link came from, when there is one.
    pub annotation_ref: Option<String>,
}

/// One tag as the app models it (TS `Tag`). An unset colour is left out of the output.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct Tag {
    /// The tag's id.
    pub id: String,
    /// The tag's display name.
    pub name: String,
    /// The tag's colour, when set.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub color: Option<String>,
}

/// One paper-tag link as the app models it (TS `PaperTag`). An absent annotation is left out.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct PaperTag {
    /// Id of the tagged paper.
    pub paper_id: String,
    /// Id of the tag.
    pub tag_id: String,
    /// How the link was made (a `TagSource` value, carried as stored).
    pub source: String,
    /// The annotation the link came from, when there is one.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub annotation_ref: Option<String>,
}

/// The tag a row maps to (`toTagDomain`). A `null` colour becomes an absent colour.
#[must_use]
pub fn to_tag(row: &TagRow) -> Tag {
    Tag {
        id: row.id.clone(),
        name: row.name.clone(),
        color: row.color.clone(),
    }
}

/// The paper-tag link a row maps to (`toPaperTagDomain`). A `null` annotation becomes absent.
#[must_use]
pub fn to_paper_tag(row: &PaperTagRow) -> PaperTag {
    PaperTag {
        paper_id: row.paper_id.clone(),
        tag_id: row.tag_id.clone(),
        source: row.source.clone(),
        annotation_ref: row.annotation_ref.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tag_keeps_colour_when_set() {
        let row = TagRow {
            id: "t1".into(),
            name: "method".into(),
            color: Some("#00ff00".into()),
        };
        assert_eq!(to_tag(&row).color.as_deref(), Some("#00ff00"));
    }

    #[test]
    fn null_colour_is_absent_in_json() {
        let row = TagRow {
            id: "t1".into(),
            name: "method".into(),
            color: None,
        };
        let json = serde_json::to_value(to_tag(&row)).expect("serialises");
        assert!(json.get("color").is_none());
        assert_eq!(json["name"], "method");
    }

    #[test]
    fn paper_tag_maps_snake_case_row_to_camel_case() {
        let row = PaperTagRow {
            paper_id: "p1".into(),
            tag_id: "t1".into(),
            source: "manual".into(),
            annotation_ref: None,
        };
        let json = serde_json::to_value(to_paper_tag(&row)).expect("serialises");
        assert_eq!(json["paperId"], "p1");
        assert_eq!(json["tagId"], "t1");
        assert_eq!(json["source"], "manual");
        assert!(json.get("annotationRef").is_none());
    }

    #[test]
    fn paper_tag_keeps_annotation_ref() {
        let row = PaperTagRow {
            paper_id: "p1".into(),
            tag_id: "t1".into(),
            source: "zotero_annotation".into(),
            annotation_ref: Some("ann-9".into()),
        };
        assert_eq!(to_paper_tag(&row).annotation_ref.as_deref(), Some("ann-9"));
    }
}
