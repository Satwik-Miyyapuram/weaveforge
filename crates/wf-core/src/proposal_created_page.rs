//! The page an approved `create_vault_note` made, so the review card can link to it (E27).
//! Ported from `apps/web/src/features/ai-assistant/application/proposal-preview.ts`. Pure.
//!
//! The executor returns no id, so the page is found by title and parent.

use serde::Deserialize;
use serde_json::Value;

/// The fields the lookup reads from a proposal.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ProposalPreviewItem {
    /// The proposal kind.
    pub kind: String,
    /// The proposal payload; `title` and `parentId` are read from it.
    #[serde(default)]
    #[cfg_attr(feature = "specta", specta(type = Option<specta_typescript::Unknown>))]
    pub payload: Option<Value>,
}

/// The fields the lookup reads from a vault page.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct PageRef {
    /// The page title.
    pub title: String,
    /// The parent page id, or none for a top-level page.
    #[serde(default)]
    pub parent_id: Option<String>,
}

/// Index into `pages` of the page `item` created, or `None` when `item` created no page or
/// no page matches its title and parent.
#[must_use]
pub fn created_page_index(item: &ProposalPreviewItem, pages: &[PageRef]) -> Option<usize> {
    if item.kind != "create_vault_note" {
        return None;
    }
    let payload = item.payload.as_ref().and_then(Value::as_object);
    let title = payload
        .and_then(|p| p.get("title"))
        .and_then(Value::as_str)
        .map_or("", str::trim);
    if title.is_empty() {
        return None;
    }
    let parent = payload
        .and_then(|p| p.get("parentId"))
        .and_then(Value::as_str);
    pages
        .iter()
        .position(|page| page.title == title && page.parent_id.as_deref() == parent)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn page(title: &str, parent: Option<&str>) -> PageRef {
        PageRef {
            title: title.to_owned(),
            parent_id: parent.map(str::to_owned),
        }
    }

    fn item(kind: &str, payload: Value) -> ProposalPreviewItem {
        ProposalPreviewItem {
            kind: kind.to_owned(),
            payload: Some(payload),
        }
    }

    #[test]
    fn finds_the_page_by_trimmed_title_and_parent() {
        let pages = [page("Adam", None), page("Adam", Some("wiki"))];
        let got = created_page_index(
            &item(
                "create_vault_note",
                json!({ "title": "  Adam ", "parentId": "wiki" }),
            ),
            &pages,
        );
        assert_eq!(got, Some(1));
    }

    #[test]
    fn a_missing_parent_matches_a_top_level_page_only() {
        let pages = [page("Adam", Some("wiki"))];
        assert_eq!(
            created_page_index(
                &item("create_vault_note", json!({ "title": "Adam" })),
                &pages
            ),
            None
        );
    }

    #[test]
    fn other_kinds_and_empty_titles_find_nothing() {
        let pages = [page("GAN", Some("wiki"))];
        assert_eq!(
            created_page_index(
                &item(
                    "append_paper_note",
                    json!({ "title": "GAN", "parentId": "wiki" })
                ),
                &pages
            ),
            None
        );
        assert_eq!(
            created_page_index(&item("create_vault_note", json!({})), &pages),
            None
        );
    }
}
