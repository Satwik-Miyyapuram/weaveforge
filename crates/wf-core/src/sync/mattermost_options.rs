//! Mattermost notification routing, ported from
//! `apps/web/src/features/sync/domain/mattermost-options.ts`.
//!
//! Events are switched on one by one, and each posts either to the connection's
//! channel or to its own channel when the person chose per-event routing.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::integration_fields::Integration;
use crate::search::js_text::is_js_whitespace;

/// Every kind of post the app can send to Mattermost.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub enum MattermostEvent {
    /// A milestone was added on the plan.
    MilestoneAdded,
    /// A milestone moved to a new status.
    MilestoneStatus,
    /// A tracked paper gained citing papers.
    CitationAlerts,
    /// A daily logbook entry was added.
    DailyLogs,
    /// A weekly logbook entry was added.
    WeeklyLogs,
}

impl MattermostEvent {
    /// The camelCase name the stored options and the TypeScript use.
    #[must_use]
    pub const fn key(self) -> &'static str {
        match self {
            Self::MilestoneAdded => "milestoneAdded",
            Self::MilestoneStatus => "milestoneStatus",
            Self::CitationAlerts => "citationAlerts",
            Self::DailyLogs => "dailyLogs",
            Self::WeeklyLogs => "weeklyLogs",
        }
    }
}

/// One event as the settings panel lists it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct MattermostEventInfo {
    /// The event this row switches.
    pub id: MattermostEvent,
    /// Short name shown in the list.
    pub label: String,
    /// One line on when the event fires.
    pub hint: String,
}

/// The events in the order the settings panel shows them.
#[must_use]
pub fn mattermost_events() -> Vec<MattermostEventInfo> {
    let row = |id: MattermostEvent, label: &str, hint: &str| MattermostEventInfo {
        id,
        label: label.to_owned(),
        hint: hint.to_owned(),
    };
    vec![
        row(
            MattermostEvent::DailyLogs,
            "Daily log entries",
            "Each new daily entry you add in the logbook",
        ),
        row(
            MattermostEvent::WeeklyLogs,
            "Weekly log entries",
            "Each new weekly entry you add in the logbook",
        ),
        row(
            MattermostEvent::MilestoneAdded,
            "New milestones",
            "When you add a milestone on the plan",
        ),
        row(
            MattermostEvent::MilestoneStatus,
            "Milestone status changes",
            "When a milestone moves to a new status",
        ),
        row(
            MattermostEvent::CitationAlerts,
            "New-citation alerts",
            "When a tracked paper gets new citing papers",
        ),
    ]
}

/// The stored Mattermost options, read with defaults for anything missing.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct MattermostOptions {
    /// Switched-on events by name. Anything missing is off, so linking a channel sends nothing until chosen.
    pub events: BTreeMap<String, bool>,
    /// True: every event goes to the connection's channel. False: per-event channels below.
    pub same_channel: bool,
    /// Per-event channel id, used only when `same_channel` is false; blank falls back to the main channel.
    pub channels: BTreeMap<String, String>,
}

/// The options of an integration, with the defaults applied.
#[must_use]
pub fn mattermost_options(i: &Integration) -> MattermostOptions {
    let raw = i.options.as_ref().and_then(Value::as_object);
    let section = |name: &str| raw.and_then(|o| o.get(name)).and_then(Value::as_object);
    MattermostOptions {
        events: section("events")
            .map(|m| {
                m.iter()
                    .filter_map(|(k, v)| v.as_bool().map(|b| (k.clone(), b)))
                    .collect()
            })
            .unwrap_or_default(),
        same_channel: raw.and_then(|o| o.get("sameChannel")) != Some(&Value::Bool(false)),
        channels: section("channels")
            .map(|m| {
                m.iter()
                    .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_owned())))
                    .collect()
            })
            .unwrap_or_default(),
    }
}

/// The channel this event posts to, or `None` when the event is switched off.
#[must_use]
pub fn mattermost_channel_for(i: &Integration, event: MattermostEvent) -> Option<String> {
    let o = mattermost_options(i);
    let key = event.key();
    if o.events.get(key) != Some(&true) {
        return None;
    }
    let own = if o.same_channel {
        ""
    } else {
        o.channels
            .get(key)
            .map_or("", |c| c.trim_matches(is_js_whitespace))
    };
    let channel = if own.is_empty() {
        i.branch.trim_matches(is_js_whitespace)
    } else {
        own
    };
    (!channel.is_empty()).then(|| channel.to_owned())
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn integration(options: Value) -> Integration {
        Integration {
            enabled: true,
            token: Some("t".into()),
            repo: Some("https://chat.example.com".into()),
            branch: "main-ch".into(),
            options: Some(options),
        }
    }

    #[test]
    fn the_list_is_in_panel_order_with_labels() {
        let events = mattermost_events();
        let ids: Vec<&str> = events.iter().map(|e| e.id.key()).collect();
        assert_eq!(
            ids,
            [
                "dailyLogs",
                "weeklyLogs",
                "milestoneAdded",
                "milestoneStatus",
                "citationAlerts"
            ]
        );
        assert_eq!(events[0].label, "Daily log entries");
    }

    #[test]
    fn a_linked_channel_with_no_events_posts_nothing() {
        let i = integration(json!({}));
        for e in mattermost_events() {
            assert_eq!(mattermost_channel_for(&i, e.id), None);
        }
    }

    #[test]
    fn a_switched_on_event_posts_to_the_main_channel() {
        let i = integration(json!({ "events": { "dailyLogs": true } }));
        assert_eq!(
            mattermost_channel_for(&i, MattermostEvent::DailyLogs).as_deref(),
            Some("main-ch")
        );
        assert_eq!(
            mattermost_channel_for(&i, MattermostEvent::WeeklyLogs),
            None
        );
    }

    #[test]
    fn same_channel_mode_ignores_per_event_channels() {
        let i = integration(json!({
            "sameChannel": true,
            "events": { "dailyLogs": true },
            "channels": { "dailyLogs": "logs-ch" }
        }));
        assert_eq!(
            mattermost_channel_for(&i, MattermostEvent::DailyLogs).as_deref(),
            Some("main-ch")
        );
    }

    #[test]
    fn per_event_channels_route_and_blank_falls_back() {
        let i = integration(json!({
            "sameChannel": false,
            "events": { "dailyLogs": true, "milestoneStatus": true, "milestoneAdded": true },
            "channels": { "dailyLogs": "logs-ch", "milestoneStatus": "plan-ch", "milestoneAdded": "  " }
        }));
        assert_eq!(
            mattermost_channel_for(&i, MattermostEvent::DailyLogs).as_deref(),
            Some("logs-ch")
        );
        assert_eq!(
            mattermost_channel_for(&i, MattermostEvent::MilestoneStatus).as_deref(),
            Some("plan-ch")
        );
        assert_eq!(
            mattermost_channel_for(&i, MattermostEvent::MilestoneAdded).as_deref(),
            Some("main-ch")
        );
    }

    #[test]
    fn only_a_literal_true_switches_an_event_on() {
        let i = integration(json!({ "events": { "dailyLogs": "yes", "weeklyLogs": 1 } }));
        assert_eq!(mattermost_channel_for(&i, MattermostEvent::DailyLogs), None);
        assert_eq!(
            mattermost_channel_for(&i, MattermostEvent::WeeklyLogs),
            None
        );
    }

    #[test]
    fn same_channel_defaults_to_true_unless_false() {
        assert!(mattermost_options(&integration(json!({}))).same_channel);
        assert!(mattermost_options(&integration(json!({ "sameChannel": "no" }))).same_channel);
        assert!(!mattermost_options(&integration(json!({ "sameChannel": false }))).same_channel);
    }

    #[test]
    fn blank_main_channel_gives_no_channel() {
        let mut i = integration(json!({ "events": { "dailyLogs": true } }));
        i.branch = "  ".into();
        assert_eq!(mattermost_channel_for(&i, MattermostEvent::DailyLogs), None);
    }
}
