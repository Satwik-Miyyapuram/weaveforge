//! The decisions `Puller` makes for one pull (`apps/web/src/features/offline-sync/domain/puller.ts`):
//! the page summary, what a change does to its local row, what a tombstone does, and how a
//! unique-constraint clash is named. The SQL, the writes, the conflict store calls and the retry
//! loop stay in TypeScript; this module only picks the step.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use super::conflict_settle::OpenConflictKind;
use super::outbox_sides::OutboxOp;

/// A change's table, row and server sequence, as far as a pull needs them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct SeqRow {
    /// The synced table the row belongs to.
    pub table: String,
    /// The row's id.
    pub row_id: String,
    /// The server sequence the change carries.
    #[cfg_attr(feature = "specta", specta(type = f64))]
    pub server_seq: i64,
}

/// One pull's page: the watermark it started from, the page size asked for, every change
/// fetched, and the first-pass failures.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct PullSummaryInput {
    /// The watermark before the pull.
    #[cfg_attr(feature = "specta", specta(type = f64))]
    pub watermark: i64,
    /// The page size the pull asked for.
    pub page_size: u32,
    /// Every change the server returned, in feed order.
    pub fetched: Vec<SeqRow>,
    /// The first-pass failures, in feed order.
    pub failed: Vec<SeqRow>,
}

/// The new watermark, whether more is waiting, and which failures a later change superseded.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct PullSummary {
    /// The highest of the watermark and every fetched sequence.
    #[cfg_attr(feature = "specta", specta(type = f64))]
    pub highest: i64,
    /// Whether the page was full, so the server may have more waiting.
    pub more: bool,
    /// One per failure, in the same order: true when a later change to the same row already won.
    pub stale: Vec<bool>,
}

/// The key a row's changes are grouped under.
fn row_key(row: &SeqRow) -> (&str, &str) {
    (row.table.as_str(), row.row_id.as_str())
}

/// The newest sequence fetched per row.
fn newest_by_row(rows: &[SeqRow]) -> HashMap<(&str, &str), i64> {
    let mut newest: HashMap<(&str, &str), i64> = HashMap::new();
    for row in rows {
        let slot = newest.entry(row_key(row)).or_insert(row.server_seq);
        *slot = (*slot).max(row.server_seq);
    }
    newest
}

/// Summarise one pull (`Puller.pull`): the highest sequence, `more`, and stale failures.
#[must_use]
pub fn summarize_pull(input: &PullSummaryInput) -> PullSummary {
    let highest = input
        .fetched
        .iter()
        .fold(input.watermark, |acc, row| acc.max(row.server_seq));
    let fetched = u32::try_from(input.fetched.len()).unwrap_or(u32::MAX);
    let newest = newest_by_row(&input.fetched);
    let stale = input
        .failed
        .iter()
        .map(|row| {
            newest
                .get(&row_key(row))
                .is_some_and(|seq| *seq > row.server_seq)
        })
        .collect();
    PullSummary {
        highest,
        more: fetched >= input.page_size,
        stale,
    }
}

/// The verb and base version of one op a device still owes for the row.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct OpFact {
    /// The verb of the op.
    pub op: OutboxOp,
    /// The row version the op was based on. `None` for an insert.
    #[cfg_attr(feature = "specta", specta(type = Option<f64>))]
    pub base_version: Option<i64>,
}

/// What the pull knows about one change before it picks a step. Gathered by reads only.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct PullFacts {
    /// Whether the change is a tombstone.
    pub deleted: bool,
    /// The server row version the change carries.
    #[cfg_attr(feature = "specta", specta(type = f64))]
    pub row_version: i64,
    /// The ops this device still owes for the row, oldest first.
    pub ops: Vec<OpFact>,
    /// Whether this device has a conflict store to record conflicts in.
    pub has_store: bool,
    /// The conflict open on the row, if any.
    pub open: Option<OpenConflictKind>,
    /// Whether an edit still owed to the server points at the row.
    pub referenced: bool,
}

/// What `Puller.apply` does with one change.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub enum ApplyStep {
    /// The row was deleted on the server: the tombstone step decides.
    Tombstone,
    /// Nothing to write: this device's own accepted write is back, or the change is already in.
    Skip,
    /// This device deleted the row and the server has since changed it: open a deleted-here conflict.
    OpenDeletedLocal,
    /// This device deleted the row and nothing newer is on the server: rebase the delete.
    Rebase,
    /// A deleted-here conflict is open: settle it against the server copy, no write.
    SettleOnly,
    /// Open a conflict for the owed edits, write the server row, then settle.
    OpenAndWrite,
    /// Write the row, then settle any open conflict.
    WriteAndSettle,
    /// Write the row.
    WriteOnly,
}

/// The step for a change to a row this device may still hold edits for.
fn after_local_delete(facts: &PullFacts, last: OpFact) -> ApplyStep {
    match last.base_version {
        Some(base) if base >= facts.row_version => ApplyStep::Skip,
        Some(_) if facts.has_store => ApplyStep::OpenDeletedLocal,
        _ => ApplyStep::Rebase,
    }
}

/// Whether an op's base is at or past the change's version, so the change is already in.
fn base_reaches(op: &OpFact, row_version: i64) -> bool {
    op.base_version.is_some_and(|base| base >= row_version)
}

/// The step `Puller.apply` takes for one non-tombstone change, or for a tombstone (`Tombstone`).
#[must_use]
pub fn apply_step(facts: &PullFacts) -> ApplyStep {
    if facts.deleted {
        return ApplyStep::Tombstone;
    }
    if let Some(last) = facts
        .ops
        .last()
        .copied()
        .filter(|op| op.op == OutboxOp::Delete)
    {
        return after_local_delete(facts, last);
    }
    if facts.open == Some(OpenConflictKind::DeletedLocal) {
        return ApplyStep::SettleOnly;
    }
    if !facts.ops.is_empty()
        && facts
            .ops
            .iter()
            .all(|op| base_reaches(op, facts.row_version))
    {
        return ApplyStep::Skip;
    }
    match (facts.has_store, facts.ops.is_empty()) {
        (false, _) => ApplyStep::WriteOnly,
        (true, true) => ApplyStep::WriteAndSettle,
        (true, false) => ApplyStep::OpenAndWrite,
    }
}

/// The step `Puller.tombstone` takes for a row the server deleted.
#[must_use]
pub fn tombstone_step(facts: &PullFacts) -> TombstoneStep {
    if facts.ops.last().is_some_and(|op| op.op == OutboxOp::Delete) {
        return TombstoneStep::DropAndWrite;
    }
    match facts.open {
        Some(OpenConflictKind::DeletedRemote) => TombstoneStep::Keep,
        Some(OpenConflictKind::DeletedLocal) => TombstoneStep::ResolveAndWrite,
        _ if !facts.ops.is_empty() || facts.open.is_some() || facts.referenced => {
            if facts.has_store {
                TombstoneStep::OpenDeletedRemote
            } else {
                TombstoneStep::Refuse
            }
        }
        _ => TombstoneStep::Write,
    }
}

/// What `Puller.tombstone` does with a deleted row.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub enum TombstoneStep {
    /// Deleted here too: drop this device's ops for the row and remove it.
    DropAndWrite,
    /// A deleted-on-server conflict is already open: leave it as it is.
    Keep,
    /// Both sides deleted it: resolve the open deleted-here conflict and remove the row.
    ResolveAndWrite,
    /// Local edits or a referencing row keep it: open a deleted-on-server conflict.
    OpenDeletedRemote,
    /// Local edits keep it but there is no conflict store to record them in: refuse, so the pull holds it.
    Refuse,
    /// Nothing local depends on it: remove the row.
    Write,
}

/// The phrase a unique-constraint clash carries in its message.
const UNIQUE_CLASH: &str = "unique constraint";
/// The opening of the constraint name in a unique-constraint clash message.
const NAME_OPEN: &str = "unique constraint \"";

/// Whether an error message is a unique-constraint clash (`applyGroups`).
#[must_use]
pub fn is_unique_clash(message: &str) -> bool {
    message.contains(UNIQUE_CLASH)
}

/// The constraint named in a clash message: the first `unique constraint "<name>"` with a
/// non-empty name (`Puller.mergeLocalTwin`). `None` when no name is quoted.
#[must_use]
pub fn unique_constraint_name(message: &str) -> Option<String> {
    message.match_indices(NAME_OPEN).find_map(|(at, _)| {
        let rest = &message[at + NAME_OPEN.len()..];
        let end = rest.find('"')?;
        (end > 0).then(|| rest[..end].to_owned())
    })
}

#[cfg(test)]
mod tests {
    use super::{
        ApplyStep, OpFact, PullFacts, PullSummaryInput, SeqRow, TombstoneStep, apply_step,
        is_unique_clash, summarize_pull, tombstone_step, unique_constraint_name,
    };
    use crate::sync::conflict_settle::OpenConflictKind;
    use crate::sync::outbox_sides::OutboxOp;

    fn seq(table: &str, row: &str, server_seq: i64) -> SeqRow {
        SeqRow {
            table: table.to_owned(),
            row_id: row.to_owned(),
            server_seq,
        }
    }

    fn owed(op: OutboxOp, base_version: Option<i64>) -> OpFact {
        OpFact { op, base_version }
    }

    /// A non-deleted change at version 5, stored locally, with no conflict open.
    fn facts(ops: Vec<OpFact>) -> PullFacts {
        PullFacts {
            deleted: false,
            row_version: 5,
            ops,
            has_store: true,
            open: None,
            referenced: false,
        }
    }

    #[test]
    fn summary_takes_highest_sequence_and_flags_full_page() {
        let input = PullSummaryInput {
            watermark: 3,
            page_size: 2,
            fetched: vec![seq("paper", "a", 7), seq("paper", "b", 4)],
            failed: vec![],
        };
        let summary = summarize_pull(&input);
        assert_eq!(summary.highest, 7);
        assert!(summary.more);
    }

    #[test]
    fn summary_keeps_watermark_when_nothing_fetched_and_short_page_is_not_more() {
        let input = PullSummaryInput {
            watermark: 9,
            page_size: 500,
            fetched: vec![],
            failed: vec![],
        };
        let summary = summarize_pull(&input);
        assert_eq!(summary.highest, 9);
        assert!(!summary.more);
    }

    #[test]
    fn summary_marks_failure_stale_only_when_later_change_to_same_row_won() {
        let input = PullSummaryInput {
            watermark: 0,
            page_size: 10,
            fetched: vec![
                seq("paper", "a", 1),
                seq("paper", "a", 3),
                seq("paper", "b", 2),
            ],
            failed: vec![seq("paper", "a", 1), seq("paper", "b", 2)],
        };
        assert_eq!(summarize_pull(&input).stale, vec![true, false]);
    }

    #[test]
    fn apply_tombstones_deleted_change() {
        let mut change = facts(vec![]);
        change.deleted = true;
        assert_eq!(apply_step(&change), ApplyStep::Tombstone);
    }

    #[test]
    fn apply_skips_own_delete_whose_base_reaches_version() {
        let change = facts(vec![owed(OutboxOp::Delete, Some(5))]);
        assert_eq!(apply_step(&change), ApplyStep::Skip);
    }

    #[test]
    fn apply_opens_deleted_local_when_delete_base_is_behind_and_store_exists() {
        let change = facts(vec![owed(OutboxOp::Delete, Some(4))]);
        assert_eq!(apply_step(&change), ApplyStep::OpenDeletedLocal);
    }

    #[test]
    fn apply_rebases_delete_without_base_or_without_store() {
        let no_base = facts(vec![owed(OutboxOp::Delete, None)]);
        assert_eq!(apply_step(&no_base), ApplyStep::Rebase);
        let mut no_store = facts(vec![owed(OutboxOp::Delete, Some(4))]);
        no_store.has_store = false;
        assert_eq!(apply_step(&no_store), ApplyStep::Rebase);
    }

    #[test]
    fn apply_settles_only_when_deleted_local_conflict_is_open() {
        let mut change = facts(vec![owed(OutboxOp::Update, Some(1))]);
        change.open = Some(OpenConflictKind::DeletedLocal);
        assert_eq!(apply_step(&change), ApplyStep::SettleOnly);
    }

    #[test]
    fn apply_skips_when_every_owed_op_is_already_on_server() {
        let change = facts(vec![
            owed(OutboxOp::Update, Some(5)),
            owed(OutboxOp::Update, Some(6)),
        ]);
        assert_eq!(apply_step(&change), ApplyStep::Skip);
    }

    #[test]
    fn apply_opens_and_writes_when_owed_edits_clash_and_store_exists() {
        let change = facts(vec![owed(OutboxOp::Update, Some(1))]);
        assert_eq!(apply_step(&change), ApplyStep::OpenAndWrite);
    }

    #[test]
    fn apply_writes_only_when_owed_edits_exist_without_store() {
        let mut change = facts(vec![owed(OutboxOp::Update, Some(1))]);
        change.has_store = false;
        assert_eq!(apply_step(&change), ApplyStep::WriteOnly);
    }

    #[test]
    fn apply_writes_and_settles_when_nothing_is_owed() {
        assert_eq!(apply_step(&facts(vec![])), ApplyStep::WriteAndSettle);
        let mut no_store = facts(vec![]);
        no_store.has_store = false;
        assert_eq!(apply_step(&no_store), ApplyStep::WriteOnly);
    }

    #[test]
    fn tombstone_drops_row_when_device_also_deleted_it() {
        let change = PullFacts {
            deleted: true,
            ..facts(vec![owed(OutboxOp::Delete, Some(2))])
        };
        assert_eq!(tombstone_step(&change), TombstoneStep::DropAndWrite);
    }

    #[test]
    fn tombstone_keeps_row_when_deleted_remote_conflict_is_open() {
        let mut change = facts(vec![owed(OutboxOp::Update, Some(1))]);
        change.open = Some(OpenConflictKind::DeletedRemote);
        assert_eq!(tombstone_step(&change), TombstoneStep::Keep);
    }

    #[test]
    fn tombstone_resolves_when_both_sides_deleted() {
        let mut change = facts(vec![]);
        change.open = Some(OpenConflictKind::DeletedLocal);
        assert_eq!(tombstone_step(&change), TombstoneStep::ResolveAndWrite);
    }

    #[test]
    fn tombstone_opens_deleted_remote_when_edits_or_references_keep_row() {
        let edited = facts(vec![owed(OutboxOp::Update, Some(1))]);
        assert_eq!(tombstone_step(&edited), TombstoneStep::OpenDeletedRemote);
        let mut referenced = facts(vec![]);
        referenced.referenced = true;
        assert_eq!(
            tombstone_step(&referenced),
            TombstoneStep::OpenDeletedRemote
        );
        let mut open_edit = facts(vec![]);
        open_edit.open = Some(OpenConflictKind::Edit);
        assert_eq!(tombstone_step(&open_edit), TombstoneStep::OpenDeletedRemote);
    }

    #[test]
    fn tombstone_refuses_kept_row_without_store() {
        let mut edited = facts(vec![owed(OutboxOp::Update, Some(1))]);
        edited.has_store = false;
        assert_eq!(tombstone_step(&edited), TombstoneStep::Refuse);
    }

    #[test]
    fn tombstone_writes_when_nothing_local_depends_on_row() {
        assert_eq!(tombstone_step(&facts(vec![])), TombstoneStep::Write);
    }

    #[test]
    fn unique_constraint_name_is_read_from_quoted_clash_message() {
        let message = "duplicate key value violates unique constraint \"paper_doi_key\"";
        assert_eq!(
            unique_constraint_name(message).as_deref(),
            Some("paper_doi_key")
        );
        assert!(is_unique_clash(message));
    }

    #[test]
    fn unique_constraint_name_none_without_quoted_name() {
        assert_eq!(unique_constraint_name("unique constraint \"\""), None);
        assert_eq!(unique_constraint_name("unique constraint paper"), None);
        assert_eq!(unique_constraint_name("boom"), None);
        assert!(!is_unique_clash("boom"));
    }
}
