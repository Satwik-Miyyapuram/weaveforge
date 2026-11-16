//! The sync dot's state, label and tooltip (`domain/sync-status.ts`). Conflicts
//! outrank everything, since they are the only state that needs the person.

use serde::{Deserialize, Serialize};

/// Which dot the account menu shows.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "lowercase")]
pub enum SyncDotState {
    /// The last sync finished and nothing is waiting.
    Synced,
    /// A cycle is running now.
    Syncing,
    /// No network, or the phase says offline.
    Offline,
    /// One or more conflicts need the person.
    Conflict,
    /// The last cycle threw while online.
    Error,
}

/// The live sync state the dot reads, as the TypeScript passes it.
#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct SyncDotInput {
    /// The live phase: `idle`, `syncing`, `offline`, `error` or `needs-adoption`.
    pub phase: String,
    /// Whether this account syncs at all.
    pub enabled: bool,
    /// Whether the browser reports a connection.
    pub is_online: bool,
    /// How many conflicts need the person.
    pub conflicts_count: u32,
    /// The last sync as a short phrase (e.g. "Just now", "5 min ago"), or `None` before the first sync.
    pub relative_last_sync: Option<String>,
}

/// One dot: its state, a short label and the tooltip in words.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct SyncDot {
    /// Which state the dot shows.
    pub state: SyncDotState,
    /// The short label beside the dot.
    pub label: String,
    /// The tooltip.
    pub tip: String,
}

/// The dot for this state (TS `syncStatus`). `None` when this account does not sync and is online.
#[must_use]
pub fn sync_dot(input: &SyncDotInput) -> Option<SyncDot> {
    let conflicts = input.conflicts_count;
    if conflicts > 0 {
        let label = format!(
            "{conflicts} conflict{}",
            if conflicts == 1 { "" } else { "s" }
        );
        let tip = format!("{label} need you. Click to resolve.");
        return Some(SyncDot {
            state: SyncDotState::Conflict,
            label,
            tip,
        });
    }
    if !input.is_online || input.phase == "offline" {
        return Some(dot(
            SyncDotState::Offline,
            "Offline",
            "Offline. Changes are saved on this device and sync when you reconnect.",
        ));
    }
    if !input.enabled {
        return None;
    }
    match input.phase.as_str() {
        "syncing" => Some(dot(
            SyncDotState::Syncing,
            "Syncing…",
            "Syncing changes with the cloud…",
        )),
        "error" => Some(dot(
            SyncDotState::Error,
            "Sync failed",
            "The last sync did not finish. Changes are safe on this device. Click to try again.",
        )),
        _ => {
            let ago = match input.relative_last_sync.as_deref() {
                Some("Just now") => " just now".to_owned(),
                Some(when) if !when.is_empty() => format!(" {when}"),
                _ => String::new(),
            };
            Some(SyncDot {
                state: SyncDotState::Synced,
                label: "Synced".to_owned(),
                tip: format!("Synced{ago}. Click to sync now."),
            })
        }
    }
}

fn dot(state: SyncDotState, label: &str, tip: &str) -> SyncDot {
    SyncDot {
        state,
        label: label.to_owned(),
        tip: tip.to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::{SyncDotInput, SyncDotState, sync_dot};

    fn base() -> SyncDotInput {
        SyncDotInput {
            phase: "idle".to_owned(),
            enabled: true,
            is_online: true,
            conflicts_count: 0,
            relative_last_sync: None,
        }
    }

    #[test]
    fn synced_says_when_it_last_ran() {
        let mut input = base();
        assert_eq!(
            sync_dot(&input).map(|d| d.tip).as_deref(),
            Some("Synced. Click to sync now.")
        );
        input.relative_last_sync = Some("Just now".to_owned());
        assert_eq!(
            sync_dot(&input).map(|d| d.tip).as_deref(),
            Some("Synced just now. Click to sync now.")
        );
        input.relative_last_sync = Some("5 min ago".to_owned());
        assert_eq!(
            sync_dot(&input).map(|d| d.tip).as_deref(),
            Some("Synced 5 min ago. Click to sync now.")
        );
    }

    #[test]
    fn conflicts_outrank_every_other_state() {
        let mut input = base();
        input.conflicts_count = 1;
        input.phase = "syncing".to_owned();
        let dot = sync_dot(&input).expect("a conflict always shows");
        assert_eq!(dot.state, SyncDotState::Conflict);
        assert_eq!(dot.label, "1 conflict");
        input.conflicts_count = 2;
        assert_eq!(
            sync_dot(&input).map(|d| d.label).as_deref(),
            Some("2 conflicts")
        );
    }

    #[test]
    fn offline_and_syncing_and_error() {
        let mut input = base();
        input.is_online = false;
        assert_eq!(
            sync_dot(&input).map(|d| d.state),
            Some(SyncDotState::Offline)
        );
        input.is_online = true;
        input.phase = "offline".to_owned();
        assert_eq!(
            sync_dot(&input).map(|d| d.state),
            Some(SyncDotState::Offline)
        );
        input.phase = "syncing".to_owned();
        assert_eq!(
            sync_dot(&input).map(|d| d.state),
            Some(SyncDotState::Syncing)
        );
        input.phase = "error".to_owned();
        assert_eq!(
            sync_dot(&input).map(|d| d.label).as_deref(),
            Some("Sync failed")
        );
    }

    #[test]
    fn a_disabled_account_shows_nothing_unless_offline() {
        let mut input = base();
        input.enabled = false;
        assert_eq!(sync_dot(&input), None);
        input.is_online = false;
        assert_eq!(
            sync_dot(&input).map(|d| d.state),
            Some(SyncDotState::Offline)
        );
    }
}
