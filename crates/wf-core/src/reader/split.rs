//! The reader's side panel: which pane sits beside the PDF. A port of
//! `apps/web/src/features/reader/application/reader-split.ts`.

use serde::{Deserialize, Serialize};

/// The pane open beside the PDF (TS `ReaderSplitPane` without `null`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "lowercase")]
pub enum ReaderSplitPane {
    /// The report section.
    Report,
    /// The vault note.
    Vault,
}

/// The pane a `pane` query value names; `None` for any other value and for no value.
#[must_use]
pub fn parse_reader_split_pane(raw: Option<&str>) -> Option<ReaderSplitPane> {
    match raw? {
        "report" => Some(ReaderSplitPane::Report),
        "vault" => Some(ReaderSplitPane::Vault),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_report_and_vault_only() {
        assert_eq!(
            parse_reader_split_pane(Some("report")),
            Some(ReaderSplitPane::Report)
        );
        assert_eq!(
            parse_reader_split_pane(Some("vault")),
            Some(ReaderSplitPane::Vault)
        );
        assert_eq!(parse_reader_split_pane(Some("other")), None);
        assert_eq!(parse_reader_split_pane(None), None);
    }
}
