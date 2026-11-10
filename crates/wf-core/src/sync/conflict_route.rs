//! Where the outbox pump sends an op the server refused as stale, decided from the server's
//! answer (wf-core `sync::conflict_route`). Ports the branching in `OutboxPump.conflict` in
//! `apps/web/src/features/offline-sync/domain/pump.ts`. The outbox writes, the conflict store
//! calls and the merge stay in TypeScript; this module only picks the route.

use serde::{Deserialize, Serialize};

use super::outbox_sides::OutboxOp;

const DELETED_LOCAL_REASON: &str = "Deleted here, edited elsewhere; kept until you decide.";
const DELETED_REMOTE_REASON: &str = "Deleted elsewhere, edited here; kept until you decide.";
const NO_ROW_REASON: &str = "The server has no row here; kept until it says why.";
const REFUSED_INSERT_REASON: &str = "The server refused this new row; it is kept and retried.";
const REINSERT_REASON: &str = "The server never got this row; sending it whole.";
const NEWER_UNKNOWN_REASON: &str = "A newer version on the server.";

/// What the server said about the row the op touches.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "lowercase")]
pub enum ServerRow {
    /// The server's current row came back with the refusal.
    Row,
    /// The server answered and holds no row at this id.
    Absent,
    /// The transport could not read the row.
    Unknown,
}

/// The facts a stale-op decision needs. All of them are known before any write.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ConflictInput {
    /// The verb of the op that was refused.
    pub op: OutboxOp,
    /// The server's row version, or `None` when it could not be read.
    #[cfg_attr(feature = "specta", specta(type = Option<f64>))]
    pub server_version: Option<i64>,
    /// The server's row, as far as the refusal said.
    pub server_row: ServerRow,
    /// With `ServerRow::Absent`: whether the server records deleting the row. `None` when unknown.
    pub deleted_elsewhere: Option<bool>,
    /// Whether this device has a conflict store to write the merge or the deleted-row record to.
    pub has_store: bool,
}

/// The step the pump takes for a refused op.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(tag = "action", rename_all = "camelCase")]
pub enum ConflictRoute {
    /// Open a conflict for a row deleted here and edited on the server; a reader decides.
    OpenDeletedLocal,
    /// The server deleted the row and this device's op is moot: forget this device's ops for it.
    DropRow,
    /// Keep the op and record why. `rebase_to` is the server version later ops on the row
    /// build on, when the server said it.
    Fail {
        /// Why the op failed.
        reason: String,
        /// The server version to rebase onto, when known.
        #[serde(rename = "rebaseTo")]
        #[cfg_attr(feature = "specta", specta(type = Option<f64>))]
        rebase_to: Option<i64>,
    },
    /// Open a conflict for a row edited here and deleted on the server.
    OpenDeletedRemote,
    /// The server never received the row: send the op again as the whole-row insert.
    Reinsert {
        /// Why the row is sent again.
        reason: String,
    },
    /// Merge three ways against the server's row now.
    Merge,
}

/// The route for an op the server refused as stale.
#[must_use]
pub fn conflict_route(input: &ConflictInput) -> ConflictRoute {
    match input.op {
        OutboxOp::Delete => {
            if input.server_row == ServerRow::Row && input.has_store {
                return ConflictRoute::OpenDeletedLocal;
            }
            if input.server_row == ServerRow::Absent && input.deleted_elsewhere == Some(true) {
                return ConflictRoute::DropRow;
            }
            ConflictRoute::Fail {
                reason: DELETED_LOCAL_REASON.to_owned(),
                rebase_to: input.server_version,
            }
        }
        OutboxOp::Update if input.server_row == ServerRow::Absent => {
            match input.deleted_elsewhere {
                Some(true) if input.has_store => ConflictRoute::OpenDeletedRemote,
                Some(true) => fail(DELETED_REMOTE_REASON),
                Some(false) => ConflictRoute::Reinsert {
                    reason: REINSERT_REASON.to_owned(),
                },
                None => fail(NO_ROW_REASON),
            }
        }
        OutboxOp::Insert if input.server_row == ServerRow::Absent => fail(REFUSED_INSERT_REASON),
        _ if !input.has_store || input.server_row != ServerRow::Row => {
            fail(&newer_reason(input.server_version))
        }
        _ => ConflictRoute::Merge,
    }
}

fn fail(reason: &str) -> ConflictRoute {
    ConflictRoute::Fail {
        reason: reason.to_owned(),
        rebase_to: None,
    }
}

fn newer_reason(version: Option<i64>) -> String {
    match version {
        None => NEWER_UNKNOWN_REASON.to_owned(),
        Some(version) => format!("Newer version {version} on the server."),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(op: OutboxOp, row: ServerRow) -> ConflictInput {
        ConflictInput {
            op,
            server_version: Some(4),
            server_row: row,
            deleted_elsewhere: None,
            has_store: true,
        }
    }

    #[test]
    fn delete_with_remote_row_opens_a_conflict() {
        assert_eq!(
            conflict_route(&input(OutboxOp::Delete, ServerRow::Row)),
            ConflictRoute::OpenDeletedLocal,
        );
    }

    #[test]
    fn delete_the_server_also_deleted_drops_the_row() {
        let mut case = input(OutboxOp::Delete, ServerRow::Absent);
        case.deleted_elsewhere = Some(true);
        assert_eq!(conflict_route(&case), ConflictRoute::DropRow);
    }

    #[test]
    fn update_never_received_is_reinserted() {
        let mut case = input(OutboxOp::Update, ServerRow::Absent);
        case.deleted_elsewhere = Some(false);
        assert!(matches!(
            conflict_route(&case),
            ConflictRoute::Reinsert { .. }
        ));
    }

    #[test]
    fn update_deleted_remotely_without_store_fails_kept() {
        let mut case = input(OutboxOp::Update, ServerRow::Absent);
        case.deleted_elsewhere = Some(true);
        case.has_store = false;
        assert_eq!(
            conflict_route(&case),
            ConflictRoute::Fail {
                reason: DELETED_REMOTE_REASON.to_owned(),
                rebase_to: None,
            },
        );
    }

    #[test]
    fn refused_insert_is_kept_and_retried() {
        assert_eq!(
            conflict_route(&input(OutboxOp::Insert, ServerRow::Absent)),
            ConflictRoute::Fail {
                reason: REFUSED_INSERT_REASON.to_owned(),
                rebase_to: None,
            },
        );
    }

    #[test]
    fn newer_row_with_store_merges() {
        assert_eq!(
            conflict_route(&input(OutboxOp::Update, ServerRow::Row)),
            ConflictRoute::Merge,
        );
    }

    #[test]
    fn newer_row_without_store_fails_with_version() {
        let mut case = input(OutboxOp::Update, ServerRow::Row);
        case.has_store = false;
        assert_eq!(
            conflict_route(&case),
            ConflictRoute::Fail {
                reason: "Newer version 4 on the server.".to_owned(),
                rebase_to: None,
            },
        );
    }
}
