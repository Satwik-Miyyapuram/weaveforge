//! Markdown channel messages for Mattermost plan updates: a milestone event, a citation
//! alert and a log entry (TS `features/sync/infrastructure/mattermost-notifier.ts`).
//!
//! Locale-free. Integers arrive as numbers, decimals and locale-formatted counts arrive
//! as strings that the caller formatted (`String(n)` or `toLocaleString()`), so this module
//! never picks a number format itself.

use serde::Deserialize;

use crate::enum_label::enum_label;
use crate::logbook::log_entry::LogKind;

/// Whether a milestone was just added or its status changed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "lowercase")]
pub enum MilestoneEvent {
    /// A new milestone was created.
    Added,
    /// An existing milestone changed status.
    Status,
}

/// One compute requirement, shown as `count resource ~hours h`.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[cfg_attr(feature = "specta", serde(rename = "ComputeLineInput"))]
#[serde(rename_all = "camelCase")]
pub struct ComputeLine {
    /// Resource name (GPU model, partition, `CPU`, ...).
    pub resource: String,
    /// Unit count. Zero and absent are left out of the line.
    pub count: Option<f64>,
    /// Hours, already formatted by the caller (`String(hours)`). Absent when unset.
    pub hours: Option<String>,
}

/// Input for [`milestone_message`].
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct MilestoneMessageInput {
    /// Added or status change.
    pub event: MilestoneEvent,
    /// Milestone title.
    pub title: String,
    /// Raw status value (for example `in_progress`), labelled through `milestoneStatus`.
    pub status: String,
    /// Target date (`yyyy-mm-dd`). Empty or absent means no target line.
    pub target_date: Option<String>,
    /// Compute requirements. An empty list means no compute line.
    pub compute: Vec<ComputeLine>,
    /// How many dependencies the milestone has.
    pub dependency_count: u32,
}

/// Channel message for a milestone event (add or status change).
#[must_use]
pub fn milestone_message(input: &MilestoneMessageInput) -> String {
    let head = match input.event {
        MilestoneEvent::Added => format!(":new: Milestone added: **{}**", input.title),
        MilestoneEvent::Status => format!(
            ":arrows_counterclockwise: Milestone **{}** → `{}`",
            input.title,
            enum_label("milestoneStatus", &input.status)
        ),
    };
    let mut lines = vec![head];
    if let Some(date) = input.target_date.as_deref().filter(|d| !d.is_empty()) {
        lines.push(format!("Target: {date}"));
    }
    if !input.compute.is_empty() {
        let text = input
            .compute
            .iter()
            .map(compute_text)
            .collect::<Vec<_>>()
            .join(", ");
        lines.push(format!("Compute: {text}"));
    }
    if input.dependency_count > 0 {
        lines.push(format!("Depends on {} item(s)", input.dependency_count));
    }
    lines.join("\n")
}

/// One compute requirement as text: the non-empty parts, joined by spaces.
fn compute_text(line: &ComputeLine) -> String {
    let mut parts = Vec::new();
    if let Some(count) = line.count.filter(|c| *c != 0.0) {
        parts.push(count.to_string());
    }
    if !line.resource.is_empty() {
        parts.push(line.resource.clone());
    }
    if let Some(hours) = &line.hours {
        parts.push(format!("~{hours}h"));
    }
    parts.join(" ")
}

/// One citing paper in a citation alert.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[cfg_attr(feature = "specta", serde(rename = "CitingPaperInput"))]
#[serde(rename_all = "camelCase")]
pub struct CitingPaperLine {
    /// Paper title.
    pub title: String,
    /// Link target. Empty or absent means a plain title.
    pub url: Option<String>,
    /// Publication year. Zero and absent are left out.
    pub year: Option<f64>,
    /// The citation count, already locale-formatted by the caller. Absent when unknown.
    pub citations_label: Option<String>,
}

/// Input for [`citation_alert_message`].
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct CitationAlertInput {
    /// Title of the tracked paper that gained citations.
    pub tracked_title: String,
    /// The new citing papers, in display order. Only the first ten are listed.
    pub citing: Vec<CitingPaperLine>,
}

/// Most citing papers listed in one alert before the "and N more" line.
const CITING_LIST_LIMIT: usize = 10;

/// Channel message for new citations of a tracked paper.
#[must_use]
pub fn citation_alert_message(input: &CitationAlertInput) -> String {
    let total = input.citing.len();
    let plural = if total == 1 { "" } else { "s" };
    let mut lines = vec![format!(
        ":bell: **{total} new citation{plural}** for **{}**",
        input.tracked_title
    )];
    for paper in input.citing.iter().take(CITING_LIST_LIMIT) {
        lines.push(format!(
            "- {}{}{}",
            paper_title(paper),
            paper_year(paper),
            paper_cites(paper)
        ));
    }
    if total > CITING_LIST_LIMIT {
        lines.push(format!("- …and {} more", total - CITING_LIST_LIMIT));
    }
    lines.join("\n")
}

/// The title, linked when there is a URL.
fn paper_title(paper: &CitingPaperLine) -> String {
    match paper.url.as_deref().filter(|u| !u.is_empty()) {
        Some(url) => format!("[{}]({url})", paper.title),
        None => paper.title.clone(),
    }
}

/// ` (year)`, or nothing when the year is absent or zero.
fn paper_year(paper: &CitingPaperLine) -> String {
    match paper.year.filter(|y| *y != 0.0) {
        Some(year) => format!(" ({year})"),
        None => String::new(),
    }
}

/// ` · N citations`, or nothing when the count is unknown.
fn paper_cites(paper: &CitingPaperLine) -> String {
    match &paper.citations_label {
        Some(label) => format!(" · {label} citations"),
        None => String::new(),
    }
}

/// Input for [`log_entry_message`].
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct LogEntryMessageInput {
    /// Daily or weekly entry.
    pub kind: LogKind,
    /// Calendar date (`yyyy-mm-dd`) the entry is about.
    pub entry_date: String,
    /// Markdown body of the entry.
    pub body: String,
}

/// Channel message for a log entry: a bold heading line, then the body.
#[must_use]
pub fn log_entry_message(input: &LogEntryMessageInput) -> String {
    let head = match input.kind {
        LogKind::Weekly => format!(
            ":spiral_calendar_pad: **Weekly log — {}**",
            input.entry_date
        ),
        LogKind::Daily => format!(":memo: **Daily log — {}**", input.entry_date),
    };
    format!("{head}\n{}", input.body)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn milestone(event: MilestoneEvent) -> MilestoneMessageInput {
        MilestoneMessageInput {
            event,
            title: "Draft".to_owned(),
            status: "in_progress".to_owned(),
            target_date: None,
            compute: Vec::new(),
            dependency_count: 0,
        }
    }

    #[test]
    fn added_milestone_has_only_the_head() {
        let text = milestone_message(&milestone(MilestoneEvent::Added));
        assert_eq!(text, ":new: Milestone added: **Draft**");
    }

    #[test]
    fn status_change_labels_the_status() {
        let text = milestone_message(&milestone(MilestoneEvent::Status));
        assert!(text.starts_with(":arrows_counterclockwise: Milestone **Draft** → `"));
        assert!(text.ends_with('`'));
        assert!(text.contains("In progress"));
    }

    #[test]
    fn target_compute_and_dependencies_each_add_a_line() {
        let input = MilestoneMessageInput {
            target_date: Some("2026-12-01".to_owned()),
            compute: vec![ComputeLine {
                resource: "A100".to_owned(),
                count: Some(4.0),
                hours: Some("200".to_owned()),
            }],
            dependency_count: 2,
            ..milestone(MilestoneEvent::Added)
        };
        let text = milestone_message(&input);
        assert_eq!(
            text,
            ":new: Milestone added: **Draft**\nTarget: 2026-12-01\nCompute: 4 A100 ~200h\nDepends on 2 item(s)"
        );
    }

    #[test]
    fn zero_count_and_empty_date_are_left_out() {
        let input = MilestoneMessageInput {
            target_date: Some(String::new()),
            compute: vec![ComputeLine {
                resource: "CPU".to_owned(),
                count: Some(0.0),
                hours: None,
            }],
            ..milestone(MilestoneEvent::Added)
        };
        assert_eq!(
            milestone_message(&input),
            ":new: Milestone added: **Draft**\nCompute: CPU"
        );
    }

    #[test]
    fn citation_alert_plural_links_and_counts() {
        let input = CitationAlertInput {
            tracked_title: "Base".to_owned(),
            citing: vec![CitingPaperLine {
                title: "Next".to_owned(),
                url: Some("https://x.test/p".to_owned()),
                year: Some(2025.0),
                citations_label: Some("1,234".to_owned()),
            }],
        };
        assert_eq!(
            citation_alert_message(&input),
            ":bell: **1 new citation** for **Base**\n- [Next](https://x.test/p) (2025) · 1,234 citations"
        );
    }

    #[test]
    fn citation_alert_truncates_after_ten() {
        let citing = (0..12)
            .map(|i| CitingPaperLine {
                title: format!("P{i}"),
                url: None,
                year: None,
                citations_label: None,
            })
            .collect();
        let text = citation_alert_message(&CitationAlertInput {
            tracked_title: "Base".to_owned(),
            citing,
        });
        assert!(text.starts_with(":bell: **12 new citations** for **Base**"));
        assert_eq!(text.lines().count(), 1 + 10 + 1);
        assert!(text.ends_with("- …and 2 more"));
    }

    #[test]
    fn log_entry_heading_by_kind() {
        let daily = LogEntryMessageInput {
            kind: LogKind::Daily,
            entry_date: "2026-11-10".to_owned(),
            body: "Ran it".to_owned(),
        };
        assert_eq!(
            log_entry_message(&daily),
            ":memo: **Daily log — 2026-11-10**\nRan it"
        );
        let weekly = LogEntryMessageInput {
            kind: LogKind::Weekly,
            ..daily
        };
        assert!(log_entry_message(&weekly).starts_with(":spiral_calendar_pad: **Weekly log — "));
    }
}
