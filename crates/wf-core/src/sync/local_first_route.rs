//! Local-first routing rules, ported from `apps/web/src/backend/providers/local/local-first.ts`.
//! Which tables a signed-in desktop keeps on this computer, which RPCs read both
//! ends, and how the two replies combine. Pure: no I/O.

use serde::{Deserialize, Serialize};

/// Tables the change feed carries: they are read and written on this computer.
/// See `0118_sync_change_feed.sql`, `0120` and `0138`.
pub const SYNCED_TABLES: [&str; 18] = [
    "projects",
    "papers",
    "tags",
    "paper_field_defs",
    "paper_field_values",
    "paper_relations",
    "reading_lists",
    "reading_list_items",
    "log_entries",
    "milestones",
    "experiments",
    "report_sections",
    "reader_annotations",
    "annotation_pins",
    "library_pins",
    "vault_pages",
    "screening_decisions",
    "paper_tags",
];

/// Metric reads that must see both ends: metrics do not sync.
pub const BOTH_END_RPCS: [&str; 2] = ["metric_history", "latest_metric_activity"];

/// How a both-ends RPC combines the two replies.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub enum BothEndsMerge {
    /// Both ends failed: the server's reply stands.
    ServerError,
    /// Run history lives on one end: local rows if any, else the server's rows.
    PreferLocalRows,
    /// Rows from both ends, one after the other.
    ConcatRows,
}

/// The synced table names.
#[must_use]
pub fn synced_tables() -> &'static [&'static str] {
    &SYNCED_TABLES
}

/// Whether `table` is read and written on this computer.
#[must_use]
pub fn is_synced_table(table: &str) -> bool {
    SYNCED_TABLES.contains(&table)
}

/// Whether the RPC `name` reads both ends.
#[must_use]
pub fn is_both_ends_rpc(name: &str) -> bool {
    BOTH_END_RPCS.contains(&name)
}

/// The merge rule for a both-ends RPC `name`, given which ends failed.
#[must_use]
pub fn both_ends_merge(name: &str, here_failed: bool, there_failed: bool) -> BothEndsMerge {
    if here_failed && there_failed {
        BothEndsMerge::ServerError
    } else if name == "metric_history" {
        BothEndsMerge::PreferLocalRows
    } else {
        BothEndsMerge::ConcatRows
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn synced_tables_are_listed() {
        assert_eq!(SYNCED_TABLES.len(), 18);
        assert!(is_synced_table("papers"));
        assert!(!is_synced_table("users"));
    }

    #[test]
    fn both_ends_rpcs_are_the_metric_reads() {
        assert!(is_both_ends_rpc("metric_history"));
        assert!(is_both_ends_rpc("latest_metric_activity"));
        assert!(!is_both_ends_rpc("projects"));
    }

    #[test]
    fn merge_rule_matches_the_ts_branches() {
        assert_eq!(
            both_ends_merge("metric_history", true, true),
            BothEndsMerge::ServerError
        );
        assert_eq!(
            both_ends_merge("latest_metric_activity", true, true),
            BothEndsMerge::ServerError
        );
        assert_eq!(
            both_ends_merge("metric_history", false, true),
            BothEndsMerge::PreferLocalRows
        );
        assert_eq!(
            both_ends_merge("latest_metric_activity", false, false),
            BothEndsMerge::ConcatRows
        );
        assert_eq!(
            both_ends_merge("latest_metric_activity", true, false),
            BothEndsMerge::ConcatRows
        );
    }
}
