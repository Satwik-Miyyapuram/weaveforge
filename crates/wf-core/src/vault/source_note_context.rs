//! Template context for a paper's source note (the default source-note template's `{{...}}`
//! values, built from the paper's metadata).

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

/// The paper metadata a source note is rendered from.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[allow(missing_docs)]
pub struct SourceNoteInput {
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub authors: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub year: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub venue: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub doi: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub cite_key: Option<String>,
}

/// The `{{...}}` values of the default source-note template. Missing values are empty strings;
/// `year` is a number when known, otherwise `""`. Authors are joined with `", "`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[allow(missing_docs)]
pub struct SourceNoteTemplateContext {
    pub title: String,
    pub authors: String,
    #[cfg_attr(feature = "specta", specta(type = specta_typescript::Unknown))]
    pub year: Value,
    pub venue: String,
    pub doi: String,
    pub cite_key: String,
}

/// `sourceNoteTemplateContext`: the template values for `input`.
#[must_use]
pub fn source_note_template_context(input: &SourceNoteInput) -> SourceNoteTemplateContext {
    let authors = input
        .authors
        .as_ref()
        .filter(|authors| !authors.is_empty())
        .map(|authors| authors.join(", "))
        .unwrap_or_default();
    SourceNoteTemplateContext {
        title: input.title.clone(),
        authors,
        year: input.year.map_or_else(|| json!(""), |year| json!(year)),
        venue: input.venue.clone().unwrap_or_default(),
        doi: input.doi.clone().unwrap_or_default(),
        cite_key: input.cite_key.clone().unwrap_or_default(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn joins_authors_and_blanks_missing_values() {
        let input = SourceNoteInput {
            title: "Attention".into(),
            authors: Some(vec!["A".into(), "B".into()]),
            year: Some(2017),
            venue: None,
            doi: None,
            cite_key: Some("vaswani2017".into()),
        };
        let ctx = source_note_template_context(&input);
        assert_eq!(ctx.authors, "A, B");
        assert_eq!(ctx.year, json!(2017));
        assert_eq!(ctx.venue, "");
        assert_eq!(ctx.cite_key, "vaswani2017");
    }

    #[test]
    fn empty_authors_and_unknown_year_are_blank() {
        let input = SourceNoteInput {
            title: "Untitled".into(),
            authors: Some(vec![]),
            year: None,
            venue: None,
            doi: None,
            cite_key: None,
        };
        let ctx = source_note_template_context(&input);
        assert_eq!(ctx.authors, "");
        assert_eq!(ctx.year, json!(""));
    }
}
