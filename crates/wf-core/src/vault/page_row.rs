//! Vault-page row mapping (TS `vault-page-rows.ts`). A row is the `vault_pages` table's columns
//! as the database names them. Every backend reads and writes the same table, so the mapping
//! lives here once.

use serde::{Deserialize, Serialize};

use super::page::{VaultPage, VaultPageSummary, canvas_kind};

/// A `vault_pages` row as read. `body`, `body_preview`, `pinned`, `folder` and `kind` may be absent
/// (a column a read did not select, or a row from before the column existed).
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[allow(missing_docs)]
pub struct VaultPageRow {
    pub id: String,
    pub title: String,
    #[cfg_attr(feature = "specta", specta(optional))]
    pub body: Option<String>,
    #[cfg_attr(feature = "specta", specta(optional))]
    pub body_preview: Option<String>,
    pub parent_id: Option<String>,
    #[cfg_attr(feature = "specta", specta(optional))]
    pub pinned: Option<bool>,
    #[cfg_attr(feature = "specta", specta(optional))]
    pub folder: Option<bool>,
    /// `note`, `canvas`, or NULL (a row from before migration 0157), which reads as a note.
    #[cfg_attr(feature = "specta", specta(optional))]
    #[serde(default)]
    pub kind: Option<String>,
    pub sort_order: f64,
    pub created_at: String,
    pub updated_at: String,
}

/// The row a page is written as (`toRow`). It has no `updated_at`: that column belongs to the
/// store, see [`to_row`].
#[derive(Debug, Clone, PartialEq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[allow(missing_docs)]
pub struct VaultPageWriteRow {
    pub id: String,
    pub title: String,
    pub body: String,
    pub parent_id: Option<String>,
    pub pinned: bool,
    pub folder: bool,
    /// `canvas` or `note`.
    pub kind: String,
    pub sort_order: f64,
    pub created_at: String,
}

/// The full domain page for a stored row (`toDomain`): the body is the row's body, or empty.
#[must_use]
pub fn to_domain(row: &VaultPageRow) -> VaultPage {
    VaultPage {
        summary: VaultPageSummary {
            id: row.id.clone(),
            title: row.title.clone(),
            body_preview: None,
            parent_id: row.parent_id.clone(),
            pinned: Some(row.pinned.unwrap_or(false)),
            folder: Some(row.folder.unwrap_or(false)),
            kind: canvas_kind(row.kind.as_deref()),
            sort_order: row.sort_order,
            created_at: row.created_at.clone(),
            updated_at: row.updated_at.clone(),
        },
        body: row.body.clone().unwrap_or_default(),
    }
}

/// The summary domain page for a stored row (`toSummaryDomain`): no body, a preview instead.
#[must_use]
pub fn to_summary_domain(row: &VaultPageRow) -> VaultPage {
    VaultPage {
        summary: VaultPageSummary {
            id: row.id.clone(),
            title: row.title.clone(),
            body_preview: Some(row.body_preview.clone().unwrap_or_default()),
            parent_id: row.parent_id.clone(),
            pinned: Some(row.pinned.unwrap_or(false)),
            folder: Some(row.folder.unwrap_or(false)),
            kind: canvas_kind(row.kind.as_deref()),
            sort_order: row.sort_order,
            created_at: row.created_at.clone(),
            updated_at: row.updated_at.clone(),
        },
        body: String::new(),
    }
}

/// The row a page is written as (`toRow`).
///
/// `updated_at` is deliberately absent. It is the server's column: migration `0128` attaches
/// `set_updated_at()` to `vault_pages`. Sending it from the client let the value go *backwards*
/// (a slow clock, or a client echoing the timestamp it read), and `listStamps()` reads that
/// column to decide which pages a client refetches, so an edit dated into the past was never
/// reported. The column default fills it on insert and the trigger owns it on update.
///
/// `created_at` stays: it records when the page was authored, and the offline client that made
/// the page is the authority on that.
#[must_use]
pub fn to_row(page: &VaultPage) -> VaultPageWriteRow {
    VaultPageWriteRow {
        id: page.summary.id.clone(),
        title: page.summary.title.clone(),
        body: page.body.clone(),
        parent_id: page.summary.parent_id.clone(),
        pinned: page.summary.pinned.unwrap_or(false),
        folder: page.summary.folder.unwrap_or(false),
        kind: canvas_kind(page.summary.kind.as_deref()).unwrap_or_else(|| "note".to_owned()),
        sort_order: page.summary.sort_order,
        created_at: page.summary.created_at.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(body: Option<&str>, preview: Option<&str>, pinned: Option<bool>) -> VaultPageRow {
        VaultPageRow {
            id: "p1".into(),
            title: "Notes".into(),
            body: body.map(String::from),
            body_preview: preview.map(String::from),
            parent_id: None,
            pinned,
            folder: None,
            kind: None,
            sort_order: 3.0,
            created_at: "2026-01-01T00:00:00Z".into(),
            updated_at: "2026-01-02T00:00:00Z".into(),
        }
    }

    #[test]
    fn full_domain_defaults_missing_body_and_flags() {
        let page = to_domain(&row(None, None, None));
        assert_eq!(page.body, "");
        assert_eq!(page.summary.body_preview, None);
        assert_eq!(page.summary.pinned, Some(false));
        assert_eq!(page.summary.folder, Some(false));
    }

    #[test]
    fn summary_domain_carries_preview_and_no_body() {
        let page = to_summary_domain(&row(Some("full text"), Some("preview"), Some(true)));
        assert_eq!(page.body, "");
        assert_eq!(page.summary.body_preview.as_deref(), Some("preview"));
        assert_eq!(page.summary.pinned, Some(true));
    }

    #[test]
    fn written_row_has_no_updated_at_and_defaults_body() {
        let page = to_domain(&row(None, None, None));
        let json = serde_json::to_value(to_row(&page)).unwrap();
        assert_eq!(json["body"], "");
        assert_eq!(json["pinned"], false);
        assert!(json.get("updated_at").is_none());
    }

    #[test]
    fn kind_reads_canvas_only_and_writes_note_or_canvas() {
        for (stored, read, written) in [
            (None, None, "note"),
            (Some("note"), None, "note"),
            (Some("canvas"), Some("canvas"), "canvas"),
        ] {
            let mut r = row(Some("{}"), Some("{}"), None);
            r.kind = stored.map(String::from);
            for page in [to_domain(&r), to_summary_domain(&r)] {
                assert_eq!(page.summary.kind.as_deref(), read);
            }
            let json = serde_json::to_value(to_row(&to_domain(&r))).unwrap();
            assert_eq!(json["kind"], written);
        }
    }

    #[test]
    fn a_row_without_the_kind_column_still_reads() {
        let r: VaultPageRow = serde_json::from_value(serde_json::json!({
            "id": "p", "title": "T", "parent_id": null, "sort_order": 0.0,
            "created_at": "c", "updated_at": "u"
        }))
        .unwrap();
        assert_eq!(to_domain(&r).summary.kind, None);
    }
}
