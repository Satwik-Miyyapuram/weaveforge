//! Ports `SyncStateStore.read` and the "already adopted" gate of `Adoption.run` in
//! `apps/web/src/features/offline-sync/domain/parts-1.ts` and `parts-3.ts`. The
//! SQL that reads and writes `sync_state` stays in TS.

use serde::{Deserialize, Serialize};

use super::outbox_rows::JsNumber;

/// The `sync_state` row as the local database returns it.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct SyncStateRow {
    /// The watermark, a bigint the driver may send as text; null reads as zero.
    pub watermark: Option<JsNumber>,
    /// When the last pull finished, as the database sends it.
    pub last_pull_at: Option<String>,
    /// The account this device syncs with, once adopted.
    pub account_id: Option<String>,
}

/// The sync state the engine reads.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncState {
    /// The highest server sequence this device has read.
    pub watermark: f64,
    /// When the last pull finished, if it ever did.
    pub last_pull_at: Option<String>,
    /// The account this device syncs with; null until sync is turned on.
    pub account_id: Option<String>,
}

/// `SyncStateStore.read`: a missing row reads as nothing read and nobody signed in.
#[must_use]
pub fn sync_state(row: Option<&SyncStateRow>) -> SyncState {
    match row {
        None => SyncState {
            watermark: 0.0,
            last_pull_at: None,
            account_id: None,
        },
        Some(row) => SyncState {
            watermark: row.watermark.as_ref().map_or(0.0, JsNumber::to_number),
            last_pull_at: row.last_pull_at.clone(),
            account_id: row.account_id.clone(),
        },
    }
}

/// The account a device is already adopted by, which refuses a second adoption.
/// An empty id does not count: the TS check it ports is a truthiness test.
#[must_use]
pub fn adopted_account(account_id: Option<&str>) -> Option<String> {
    account_id.filter(|id| !id.is_empty()).map(str::to_owned)
}

#[cfg(test)]
mod tests {
    use super::{SyncStateRow, adopted_account, sync_state};
    use crate::sync::outbox_rows::JsNumber;

    // it: "starts at nothing read and nobody signed in"
    #[test]
    fn starts_at_nothing_read_and_nobody_signed_in() {
        let state = sync_state(None);
        assert_eq!(state.watermark, 0.0);
        assert_eq!(state.last_pull_at, None);
        assert_eq!(state.account_id, None);
    }

    #[test]
    fn null_watermark_reads_as_zero() {
        let row = SyncStateRow {
            watermark: None,
            last_pull_at: None,
            account_id: None,
        };
        assert_eq!(sync_state(Some(&row)).watermark, 0.0);
    }

    #[test]
    fn text_watermark_reads_as_a_number() {
        let row = SyncStateRow {
            watermark: Some(JsNumber::Text("41".to_owned())),
            last_pull_at: Some("2026-11-12".to_owned()),
            account_id: Some("acct".to_owned()),
        };
        let state = sync_state(Some(&row));
        assert_eq!(state.watermark, 41.0);
        assert_eq!(state.last_pull_at.as_deref(), Some("2026-11-12"));
        assert_eq!(state.account_id.as_deref(), Some("acct"));
    }

    // it: "records the account this device was adopted by"
    #[test]
    fn adopted_account_is_the_recorded_id() {
        assert_eq!(adopted_account(Some("acct")).as_deref(), Some("acct"));
        assert_eq!(adopted_account(None), None);
    }

    #[test]
    fn empty_account_id_is_not_adopted() {
        assert_eq!(adopted_account(Some("")), None);
    }
}
