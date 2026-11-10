//! Ports the phase rules in `apps/web/src/features/offline-sync/ui/sync-loop.tsx`
//! (`syncOnce`, the catch branch, `settle`) and the initial phase in
//! `domain/live-sync.ts`: where a cycle leaves the status, and whether a pass
//! caught up. Timers and the `lastSyncAt` stamp stay in TS.

use serde::{Deserialize, Serialize};

/// The status the sync panel shows.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "lowercase")]
pub enum SyncPhase {
    /// Connected and waiting for the next cycle.
    Idle,
    /// No connection to the server.
    Offline,
    /// A cycle failed while the device was online.
    Error,
}

/// The phase and connectivity a finished or failed cycle leaves behind.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct CyclePhase {
    /// The phase to show.
    pub phase: SyncPhase,
    /// Whether the device reached the server.
    pub is_online: bool,
}

/// After a cycle that ran: offline when the push stopped for lack of a
/// connection, idle otherwise. Any other stop reason counts as connected.
#[must_use]
pub fn after_cycle(stopped_because: Option<&str>) -> CyclePhase {
    if stopped_because == Some("offline") {
        CyclePhase {
            phase: SyncPhase::Offline,
            is_online: false,
        }
    } else {
        CyclePhase {
            phase: SyncPhase::Idle,
            is_online: true,
        }
    }
}

/// After a cycle that threw: an error while online, offline otherwise.
#[must_use]
pub const fn after_failure(online: bool) -> CyclePhase {
    CyclePhase {
        phase: if online {
            SyncPhase::Error
        } else {
            SyncPhase::Offline
        },
        is_online: online,
    }
}

/// A pass is caught up when the push ran to the end and the pull has no more pages.
#[must_use]
pub const fn is_caught_up(stopped_because: Option<&str>, pulled_more: bool) -> bool {
    stopped_because.is_none() && !pulled_more
}

/// The phase before the first cycle: idle when the browser reports a connection, offline otherwise.
#[must_use]
pub const fn initial_phase(online: bool) -> SyncPhase {
    if online {
        SyncPhase::Idle
    } else {
        SyncPhase::Offline
    }
}

#[cfg(test)]
mod tests {
    use super::{CyclePhase, SyncPhase, after_cycle, after_failure, initial_phase, is_caught_up};

    #[test]
    fn offline_stop_goes_offline() {
        assert_eq!(
            after_cycle(Some("offline")),
            CyclePhase {
                phase: SyncPhase::Offline,
                is_online: false
            }
        );
    }

    #[test]
    fn other_stops_and_clean_runs_are_idle_and_online() {
        for stop in [None, Some("quota"), Some("refused")] {
            assert_eq!(
                after_cycle(stop),
                CyclePhase {
                    phase: SyncPhase::Idle,
                    is_online: true
                }
            );
        }
    }

    #[test]
    fn failure_is_error_online_and_offline_offline() {
        assert_eq!(after_failure(true).phase, SyncPhase::Error);
        assert!(after_failure(true).is_online);
        assert_eq!(after_failure(false).phase, SyncPhase::Offline);
        assert!(!after_failure(false).is_online);
    }

    #[test]
    fn caught_up_needs_no_stop_and_no_more_pages() {
        assert!(is_caught_up(None, false));
        assert!(!is_caught_up(None, true));
        assert!(!is_caught_up(Some("offline"), false));
    }

    #[test]
    fn initial_phase_follows_connectivity() {
        assert_eq!(initial_phase(true), SyncPhase::Idle);
        assert_eq!(initial_phase(false), SyncPhase::Offline);
    }
}
