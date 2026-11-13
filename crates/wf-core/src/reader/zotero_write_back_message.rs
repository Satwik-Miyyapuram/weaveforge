//! The sync line's Zotero write-back part, from a write-back summary.
//! A port of `zoteroWriteBackMessage` in apps/web/src/features/reader/application/parts-3.ts.

use serde::Deserialize;

/// Counts from one Zotero write-back run (TS `ZoteroAnnotationWriteBackSummary`).
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ZoteroWriteBackSummary {
    /// Annotations Zotero created.
    #[cfg_attr(feature = "specta", specta(type = u32))]
    pub created: usize,
    /// Annotations Zotero updated.
    #[cfg_attr(feature = "specta", specta(type = u32))]
    pub updated: usize,
    /// Annotations left as they are because Zotero changed them meanwhile.
    #[cfg_attr(feature = "specta", specta(type = u32))]
    pub conflicts: usize,
    /// Annotations that could not be sent.
    #[cfg_attr(feature = "specta", specta(type = u32))]
    pub failed: usize,
    /// The first failure's reason, so the screen can say why.
    #[cfg_attr(feature = "specta", specta(type = String, optional))]
    pub first_error: Option<String>,
}

/// The write-back's part of the sync line, led by its ` · ` separator, or `""` when
/// nothing was owed (TS `zoteroWriteBackMessage`). A missing summary gives `""`.
#[must_use]
pub fn zotero_write_back_message(summary: Option<&ZoteroWriteBackSummary>) -> String {
    let Some(summary) = summary else {
        return String::new();
    };
    let sent = summary.created + summary.updated;
    let mut parts: Vec<String> = Vec::new();
    if sent > 0 {
        let noun = if sent == 1 {
            "annotation"
        } else {
            "annotations"
        };
        parts.push(format!("sent {sent} {noun} to Zotero"));
    }
    if summary.conflicts > 0 {
        parts.push(format!(
            "{} changed in Zotero meanwhile, left as is",
            summary.conflicts
        ));
    }
    if summary.failed > 0 {
        match summary
            .first_error
            .as_deref()
            .filter(|reason| !reason.is_empty())
        {
            Some(reason) => parts.push(format!("{} could not be sent ({reason})", summary.failed)),
            None => parts.push(format!("{} could not be sent", summary.failed)),
        }
    }
    if parts.is_empty() {
        String::new()
    } else {
        format!(" · {}", parts.join(", "))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_summary_is_empty() {
        assert_eq!(zotero_write_back_message(None), "");
    }

    #[test]
    fn nothing_owed_is_empty() {
        assert_eq!(
            zotero_write_back_message(Some(&ZoteroWriteBackSummary::default())),
            ""
        );
    }

    #[test]
    fn sent_is_singular_for_one() {
        let s = ZoteroWriteBackSummary {
            created: 1,
            ..Default::default()
        };
        assert_eq!(
            zotero_write_back_message(Some(&s)),
            " · sent 1 annotation to Zotero"
        );
    }

    #[test]
    fn mixed_parts_join_in_order() {
        let s = ZoteroWriteBackSummary {
            created: 1,
            updated: 2,
            conflicts: 1,
            failed: 2,
            first_error: Some("403 Forbidden".into()),
        };
        assert_eq!(
            zotero_write_back_message(Some(&s)),
            " · sent 3 annotations to Zotero, 1 changed in Zotero meanwhile, left as is, 2 could not be sent (403 Forbidden)"
        );
    }

    #[test]
    fn empty_first_error_is_omitted() {
        let s = ZoteroWriteBackSummary {
            failed: 1,
            first_error: Some(String::new()),
            ..Default::default()
        };
        assert_eq!(
            zotero_write_back_message(Some(&s)),
            " · 1 could not be sent"
        );
    }
}
