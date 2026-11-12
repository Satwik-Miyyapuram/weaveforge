//! What the outbox pump does with one send outcome (wf-core `sync::pump_route`). Ports the
//! branching in `OutboxPump.run` in `apps/web/src/features/offline-sync/domain/parts-3.ts`:
//! stop on offline, settle an accepted op (and ack its version), hand a conflict to the
//! conflict route, and otherwise wait for a parent or fail. The outbox writes, the
//! conflict store calls, the skip loop and the `stalled` set stay in TypeScript.

use serde::{Deserialize, Serialize};

/// How the transport answered one send.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[cfg_attr(feature = "specta", serde(rename = "PumpSendStatus"))]
#[serde(rename_all = "lowercase")]
pub enum SendStatus {
    /// The request never got an answer: no network, or the transport threw.
    Offline,
    /// The server stored the op.
    Accepted,
    /// The server holds a newer version of the row.
    Conflict,
    /// The server refused the op for another reason.
    Refused,
}

/// The facts a pump route needs. All of them are known before any write.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[cfg_attr(feature = "specta", serde(rename = "PumpRouteInput"))]
#[serde(rename_all = "camelCase")]
pub struct PumpInput {
    /// How the transport answered.
    pub status: SendStatus,
    /// Whether the op is a delete. A delete never acks a version.
    pub op_is_delete: bool,
    /// Whether an accepted send came back with the version the server stored.
    pub has_new_version: bool,
    /// Whether a refused op is waiting on a parent row the server has not yet received.
    pub awaiting_parent: bool,
}

/// The step the pump takes for one op.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[cfg_attr(feature = "specta", serde(rename = "PumpRouteAction"))]
#[serde(rename_all = "lowercase")]
pub enum PumpAction {
    /// The network is down: end the run now.
    Stop,
    /// The server stored the op: settle it.
    Settle,
    /// The server has a newer version: hand the op to the conflict route.
    Conflict,
    /// Refused while the parent is still unsent: keep the op waiting.
    Wait,
    /// Refused for good: keep the op and record why.
    Fail,
}

/// The route for one send outcome.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct PumpRoute {
    /// What to do with the op.
    pub action: PumpAction,
    /// Whether the op's stored version is written back to the row (accepted, not a delete).
    pub ack: bool,
    /// Whether later ops on the same row wait for this one. True for any non-accepted send.
    pub stall: bool,
}

/// The route for one send outcome.
#[must_use]
pub fn pump_route(input: PumpInput) -> PumpRoute {
    match input.status {
        SendStatus::Offline => PumpRoute {
            action: PumpAction::Stop,
            ack: false,
            stall: false,
        },
        SendStatus::Accepted => PumpRoute {
            action: PumpAction::Settle,
            ack: input.has_new_version && !input.op_is_delete,
            stall: false,
        },
        SendStatus::Conflict => PumpRoute {
            action: PumpAction::Conflict,
            ack: false,
            stall: true,
        },
        SendStatus::Refused => PumpRoute {
            action: if input.awaiting_parent {
                PumpAction::Wait
            } else {
                PumpAction::Fail
            },
            ack: false,
            stall: true,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(status: SendStatus) -> PumpInput {
        PumpInput {
            status,
            op_is_delete: false,
            has_new_version: false,
            awaiting_parent: false,
        }
    }

    #[test]
    fn offline_stops_the_run_without_stalling() {
        let route = pump_route(input(SendStatus::Offline));
        assert_eq!(route.action, PumpAction::Stop);
        assert!(!route.stall);
        assert!(!route.ack);
    }

    #[test]
    fn accepted_settles_and_acks_a_non_delete_version() {
        let mut case = input(SendStatus::Accepted);
        case.has_new_version = true;
        let route = pump_route(case);
        assert_eq!(route.action, PumpAction::Settle);
        assert!(route.ack);
        assert!(!route.stall);
    }

    #[test]
    fn accepted_without_a_version_or_for_a_delete_does_not_ack() {
        let no_version = pump_route(input(SendStatus::Accepted));
        assert!(!no_version.ack);

        let mut delete = input(SendStatus::Accepted);
        delete.has_new_version = true;
        delete.op_is_delete = true;
        let route = pump_route(delete);
        assert_eq!(route.action, PumpAction::Settle);
        assert!(!route.ack);
    }

    #[test]
    fn conflict_goes_to_the_conflict_route_and_stalls_the_row() {
        let route = pump_route(input(SendStatus::Conflict));
        assert_eq!(route.action, PumpAction::Conflict);
        assert!(route.stall);
        assert!(!route.ack);
    }

    #[test]
    fn refused_waits_for_a_parent_or_fails_and_stalls_either_way() {
        let mut waiting = input(SendStatus::Refused);
        waiting.awaiting_parent = true;
        let wait = pump_route(waiting);
        assert_eq!(wait.action, PumpAction::Wait);
        assert!(wait.stall);

        let fail = pump_route(input(SendStatus::Refused));
        assert_eq!(fail.action, PumpAction::Fail);
        assert!(fail.stall);
    }
}
