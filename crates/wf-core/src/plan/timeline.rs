//! Plan timeline: dated milestones laid out on a track, with today's line, month ticks, clusters
//! of overlapping marks and a one-line pace summary. Pure; the caller supplies today's local day.

use super::feed::{civil_from_days, days_from_civil, parse_date};
use crate::lab_snapshot::MilestoneStatus;

const MONTHS: [&str; 12] = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
/// The track is at least this many days long, so a single date still reads.
const MIN_SPAN_DAYS: i64 = 28;
/// Milestones due within this many days count as "due soon".
const SOON_DAYS: i64 = 14;

/// The milestone fields the timeline reads. Extra fields in a full milestone are ignored.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct TimelineMilestone {
    /// Milestone id.
    pub id: String,
    /// Display title.
    pub title: String,
    /// Milestone status.
    pub status: MilestoneStatus,
    /// Target date (`yyyy-mm-dd`), when set.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub target_date: Option<String>,
}

/// A dated milestone as a mark on the track.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct PlanTimelineMark {
    /// Milestone id.
    pub id: String,
    /// Display title.
    pub title: String,
    /// Milestone status.
    pub status: MilestoneStatus,
    /// Position along the track, 0 to 100.
    #[cfg_attr(feature = "specta", specta(type = u32))]
    pub at: f64,
}

/// A month tick: the first of a month on the track.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct PlanTimelineMonth {
    /// Three-letter month name, `Jan` to `Dec`.
    pub label: String,
    /// Position along the track, 0 to 100.
    #[cfg_attr(feature = "specta", specta(type = u32))]
    pub at: f64,
}

/// The laid-out plan: marks, month ticks and where today falls.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct PlanTimeline {
    /// Dated milestones, ordered by position on the track.
    pub marks: Vec<PlanTimelineMark>,
    /// Up to six month ticks inside the track.
    pub months: Vec<PlanTimelineMonth>,
    /// Where today falls on the track, 0 to 100.
    #[cfg_attr(feature = "specta", specta(type = u32))]
    pub today: f64,
}

/// Marks close enough to overlap on the track, drawn as one stacked mark.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct PlanTimelineCluster {
    /// Position of the cluster along the track, 0 to 100.
    #[cfg_attr(feature = "specta", specta(type = u32))]
    pub at: f64,
    /// The marks stacked in this cluster, in track order.
    pub marks: Vec<PlanTimelineMark>,
}

/// Track position of `day`, given the track's first `start` day and its `span` in days, to 0.1.
#[allow(
    clippy::cast_precision_loss,
    reason = "day counts are far below 2^53, so the conversion is exact"
)]
fn track_at(day: i64, start: i64, span: i64) -> f64 {
    let fraction = (day - start) as f64 / span as f64;
    (fraction * 1000.0).round() / 10.0
}

/// Dated milestones paired with their target day. Undated or non-date values are left out.
fn dated_milestones(milestones: &[TimelineMilestone]) -> Vec<(&TimelineMilestone, i64)> {
    milestones
        .iter()
        .filter_map(|m| parse_date(m.target_date.as_deref()).map(|day| (m, day)))
        .collect()
}

/// First day of each month after `start`'s month, up to and including `end`.
fn month_firsts(start: i64, end: i64) -> Vec<i64> {
    let (mut year, mut month, _) = civil_from_days(start);
    let mut firsts = Vec::new();
    loop {
        if month == 12 {
            year += 1;
            month = 1;
        } else {
            month += 1;
        }
        let first = days_from_civil(year, month, 1);
        if first > end {
            return firsts;
        }
        firsts.push(first);
    }
}

/// Three-letter name of the month `day` falls in.
fn month_label(day: i64) -> &'static str {
    let (_, month, _) = civil_from_days(day);
    usize::try_from(month - 1)
        .ok()
        .and_then(|index| MONTHS.get(index).copied())
        .unwrap_or("")
}

/// The plan laid out in time: each dated milestone as a mark, today as a line, and up to six
/// month ticks. The track runs from the earlier of `today` and the first milestone to the later
/// of `today` and the last, and is at least 28 days long, so today is always on it.
///
/// `today` is the caller's local calendar day (`yyyy-mm-dd`). Returns `None` when no milestone
/// has a date, or when `today` is not a real date.
#[must_use]
pub fn plan_timeline(milestones: &[TimelineMilestone], today: &str) -> Option<PlanTimeline> {
    let today_day = parse_date(Some(today))?;
    let dated = dated_milestones(milestones);
    if dated.is_empty() {
        return None;
    }
    let start = dated.iter().map(|&(_, day)| day).fold(today_day, i64::min);
    let latest = dated.iter().map(|&(_, day)| day).fold(today_day, i64::max);
    let end = latest.max(start + MIN_SPAN_DAYS);
    let span = end - start;

    let mut marks: Vec<PlanTimelineMark> = dated
        .iter()
        .map(|&(m, day)| PlanTimelineMark {
            id: m.id.clone(),
            title: m.title.clone(),
            status: m.status,
            at: track_at(day, start, span),
        })
        .collect();
    marks.sort_by(|a, b| a.at.total_cmp(&b.at));

    let firsts = month_firsts(start, end);
    let step = firsts.len().div_ceil(6).max(1);
    let months = firsts
        .iter()
        .step_by(step)
        .map(|&first| PlanTimelineMonth {
            label: month_label(first).to_owned(),
            at: track_at(first, start, span),
        })
        .collect();

    Some(PlanTimeline {
        marks,
        months,
        today: track_at(today_day, start, span),
    })
}

/// Folds marks nearer than `min_gap` (track percent, about one mark's width) into clusters, so
/// milestones due on the same days never hide one another. A cluster's `at` is the midpoint of
/// its first mark and the mark just joined.
#[must_use]
pub fn cluster_marks(marks: &[PlanTimelineMark], min_gap: f64) -> Vec<PlanTimelineCluster> {
    let mut out: Vec<PlanTimelineCluster> = Vec::new();
    for mark in marks {
        let close = out
            .last()
            .and_then(|cluster| cluster.marks.last())
            .is_some_and(|prev| mark.at - prev.at < min_gap);
        if close {
            if let Some(last) = out.last_mut() {
                if let Some(first) = last.marks.first() {
                    last.at = (first.at + mark.at) / 2.0;
                }
                last.marks.push(mark.clone());
            }
        } else {
            out.push(PlanTimelineCluster {
                at: mark.at,
                marks: vec![mark.clone()],
            });
        }
    }
    out
}

/// Calendar days from `today` to `iso` (both `yyyy-mm-dd`): 0 today, 1 tomorrow, negative once
/// past. Whole days, so a 23- or 25-hour local day still counts one. `None` unless both are real
/// dates.
#[must_use]
pub fn days_until_date(iso: &str, today: &str) -> Option<i64> {
    let due = parse_date(Some(iso))?;
    let now = parse_date(Some(today))?;
    Some(due - now)
}

/// `"on track"`, or how many are overdue, then how many fall due within two weeks. Done and
/// undated milestones are ignored.
#[must_use]
pub fn plan_pace(milestones: &[TimelineMilestone], today: &str) -> String {
    let mut overdue = 0_usize;
    let mut soon = 0_usize;
    for m in milestones {
        if m.status == MilestoneStatus::Done {
            continue;
        }
        let Some(days) = m
            .target_date
            .as_deref()
            .and_then(|iso| days_until_date(iso, today))
        else {
            continue;
        };
        if days < 0 {
            overdue += 1;
        } else if days <= SOON_DAYS {
            soon += 1;
        }
    }
    let mut parts = vec![if overdue > 0 {
        format!("{overdue} overdue")
    } else {
        "on track".to_owned()
    }];
    if soon > 0 {
        parts.push(format!("{soon} due soon"));
    }
    parts.join(" · ")
}

#[cfg(test)]
#[allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    reason = "test code"
)]
mod tests {
    use super::*;

    const TODAY: &str = "2026-09-26";

    fn ms(id: &str, target: Option<&str>, status: MilestoneStatus) -> TimelineMilestone {
        TimelineMilestone {
            id: id.to_owned(),
            title: id.to_owned(),
            status,
            target_date: target.map(str::to_owned),
        }
    }

    fn mark(id: &str, at: f64) -> PlanTimelineMark {
        PlanTimelineMark {
            id: id.to_owned(),
            title: id.to_owned(),
            status: MilestoneStatus::Planned,
            at,
        }
    }

    fn ids(marks: &[PlanTimelineMark]) -> Vec<&str> {
        marks.iter().map(|m| m.id.as_str()).collect()
    }

    #[test]
    fn no_dated_milestone_no_timeline() {
        assert!(plan_timeline(&[ms("a", None, MilestoneStatus::Planned)], TODAY).is_none());
    }

    #[test]
    fn marks_placed_in_date_order_and_today_on_track() {
        let milestones = [
            ms("late", Some("2026-12-26"), MilestoneStatus::Planned),
            ms("early", Some("2026-07-26"), MilestoneStatus::Done),
        ];
        let t = plan_timeline(&milestones, TODAY).expect("dated milestones");
        assert_eq!(ids(&t.marks), ["early", "late"]);
        let ats: Vec<f64> = t.marks.iter().map(|m| m.at).collect();
        assert_eq!(ats, [0.0, 100.0]);
        assert!(t.today > 40.0 && t.today < 60.0);
    }

    #[test]
    fn today_before_every_milestone_starts_track() {
        let milestones = [ms("a", Some("2026-12-01"), MilestoneStatus::Planned)];
        let t = plan_timeline(&milestones, TODAY).expect("dated milestone");
        assert_eq!(t.today, 0.0);
        assert_eq!(t.marks.first().map(|m| m.at), Some(100.0));
    }

    #[test]
    fn month_ticks_thinned_to_six_at_most() {
        let milestones = [
            ms("a", Some("2025-01-01"), MilestoneStatus::Planned),
            ms("b", Some("2027-12-01"), MilestoneStatus::Planned),
        ];
        let t = plan_timeline(&milestones, TODAY).expect("dated milestones");
        assert!(!t.months.is_empty() && t.months.len() <= 6);
        assert!(t.months.windows(2).all(|w| w[1].at > w[0].at));
    }

    #[test]
    fn pace_counts_overdue_and_due_soon_ignoring_done() {
        let soon = [
            ms("a", Some("2026-10-01"), MilestoneStatus::Planned),
            ms("b", Some("2026-12-01"), MilestoneStatus::Planned),
        ];
        assert_eq!(plan_pace(&soon, TODAY), "on track · 1 due soon");
        let overdue = [
            ms("a", Some("2026-09-01"), MilestoneStatus::Planned),
            ms("b", Some("2026-09-01"), MilestoneStatus::Done),
        ];
        assert_eq!(plan_pace(&overdue, TODAY), "1 overdue");
    }

    #[test]
    fn marks_closer_than_gap_fold_into_one_cluster() {
        let marks = [
            mark("a", 10.0),
            mark("b", 11.0),
            mark("c", 12.5),
            mark("d", 40.0),
        ];
        let clusters = cluster_marks(&marks, 2.0);
        let grouped: Vec<Vec<&str>> = clusters.iter().map(|c| ids(&c.marks)).collect();
        assert_eq!(grouped, [vec!["a", "b", "c"], vec!["d"]]);
        assert_eq!(clusters.first().map(|c| c.at), Some(11.25));
    }
}
