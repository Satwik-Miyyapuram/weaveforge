//! Dashboard stats rules. Port of the pure parts of
//! `apps/web/src/features/dashboard/application/build-dashboard-stats.ts` and
//! `build-supervision-stats.ts`: attention lines, top tags, supervisee counts and team
//! attention. Dates are `yyyy-mm-dd` strings and `today` is an argument, so nothing reads
//! the clock.

use serde::{Deserialize, Serialize};

use crate::js_collate::locale_compare;
use crate::plan::feed::add_days;

/// Days ahead that count as "due soon" (the `horizon` in the TS code).
const DUE_SOON_DAYS: i64 = 14;

/// A paper, reduced to the field the rules read.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatPaper {
    /// `read`, `reading`, or another reading status.
    pub status: String,
}

/// An experiment, reduced to the field the rules read.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatExperiment {
    /// `running`, `done`, or another status.
    pub status: String,
}

/// A milestone, reduced to the fields the rules read.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatMilestone {
    /// Milestone title, shown in attention lines.
    pub title: String,
    /// `done`, `blocked`, or another status.
    pub status: String,
    /// `yyyy-mm-dd`, or absent when the milestone has no target.
    #[serde(default)]
    pub target_date: Option<String>,
}

/// A log entry, reduced to the date the rules read.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatLog {
    /// `yyyy-mm-dd`.
    pub entry_date: String,
}

/// A tag with the number of papers that carry it.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatTag {
    /// Tag name.
    pub name: String,
    /// Papers carrying the tag.
    pub paper_count: u64,
}

/// A supervisee: the member fields the labels use.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatMember {
    /// Member id, used in links.
    pub id: String,
    /// Full name; an empty or absent name falls back to the email.
    #[serde(default)]
    pub full_name: Option<String>,
    /// Email; the last label fallback before `Unknown`.
    #[serde(default)]
    pub email: Option<String>,
}

/// A supervisee with their milestones and logs.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatSupervisee {
    /// The member.
    pub member: StatMember,
    /// Milestones for this member.
    pub milestones: Vec<StatMilestone>,
    /// Log entries for this member.
    #[serde(default)]
    pub logs: Vec<StatLog>,
}

/// A dashboard "needs attention" line.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttentionItem {
    /// Human-readable line.
    pub label: String,
    /// App route the line links to.
    pub href: String,
}

/// A tag shown in the top-tags card.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TopTag {
    /// Tag name.
    pub name: String,
    /// Papers carrying the tag.
    pub count: u64,
}

/// One supervisee's counts and status label.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SuperviseeCounts {
    /// Milestones in total.
    pub milestones_total: u64,
    /// Milestones with status `done`.
    pub milestones_done: u64,
    /// Milestones with status `blocked`.
    pub blocked: u64,
    /// Open milestones due within the horizon.
    pub upcoming_due: u64,
    /// Most recent log date, or `None` when there are no logs.
    pub last_log_date: Option<String>,
    /// `blocked`, `N due soon`, or `on track`.
    pub status_label: String,
}

/// A team-level attention line for one supervisee milestone.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamAttentionItem {
    /// Supervisee id.
    pub member_id: String,
    /// Name shown in the label.
    pub member_name: String,
    /// Human-readable line.
    pub label: String,
    /// Supervision route for this member.
    pub href: String,
}

/// The last day counted as "due soon" for `today`. An invalid `today` falls back to
/// `today` itself. The JS code throws there, and the callers always pass `toISOString`.
fn horizon(today: &str) -> String {
    add_days(today, DUE_SOON_DAYS).unwrap_or_else(|| today.to_owned())
}

/// `yyyy-mm-dd` target date, or `None` when it is absent or empty (JS falsy).
fn target(m: &StatMilestone) -> Option<&str> {
    m.target_date.as_deref().filter(|t| !t.is_empty())
}

/// `""` for one, `"s"` otherwise.
fn plural(n: usize) -> &'static str {
    if n == 1 { "" } else { "s" }
}

/// Dashboard "needs attention" lines: unread papers, overdue and due-soon milestones, and
/// running experiments.
#[must_use]
pub fn needs_attention(
    papers: &[StatPaper],
    milestones: &[StatMilestone],
    experiments: &[StatExperiment],
    today: &str,
) -> Vec<AttentionItem> {
    let mut items = Vec::new();
    let unread = papers.iter().filter(|p| p.status != "read").count();
    if unread > 0 {
        items.push(AttentionItem {
            label: format!("{unread} paper{} unread", plural(unread)),
            href: "/papers".into(),
        });
    }
    let horizon = horizon(today);
    for m in milestones {
        let Some(date) = target(m) else { continue };
        if m.status == "done" {
            continue;
        }
        if date < today {
            items.push(AttentionItem {
                label: format!("Milestone overdue ({date}): {}", m.title),
                href: "/plan".into(),
            });
        } else if date <= horizon.as_str() {
            items.push(AttentionItem {
                label: format!("Milestone due {date}: {}", m.title),
                href: "/plan".into(),
            });
        }
    }
    let running = experiments.iter().filter(|e| e.status == "running").count();
    if running > 0 {
        items.push(AttentionItem {
            label: format!("{running} experiment{} running", plural(running)),
            href: "/experiments".into(),
        });
    }
    items
}

/// The `limit` tags with the most papers, ties broken by name (`localeCompare`).
#[must_use]
pub fn top_tags(tags: &[StatTag], limit: usize) -> Vec<TopTag> {
    let mut sorted: Vec<&StatTag> = tags.iter().collect();
    sorted.sort_by(|a, b| {
        b.paper_count
            .cmp(&a.paper_count)
            .then_with(|| locale_compare(&a.name, &b.name))
    });
    sorted
        .into_iter()
        .take(limit)
        .map(|t| TopTag {
            name: t.name.clone(),
            count: t.paper_count,
        })
        .collect()
}

fn count<T>(items: &[T], keep: impl Fn(&T) -> bool) -> u64 {
    items.iter().filter(|x| keep(x)).count() as u64
}

/// One supervisee's counts: milestone totals, blocked and due-soon counts, the latest log
/// date, and the status label (`blocked` wins over `N due soon`).
#[must_use]
pub fn supervisee_counts(
    milestones: &[StatMilestone],
    logs: &[StatLog],
    today: &str,
) -> SuperviseeCounts {
    let horizon = horizon(today);
    let blocked = count(milestones, |m| m.status == "blocked");
    let upcoming_due = count(milestones, |m| {
        m.status != "done" && target(m).is_some_and(|d| d >= today && d <= horizon.as_str())
    });
    let last_log_date = logs
        .iter()
        .map(|l| l.entry_date.as_str())
        .max_by(|a, b| locale_compare(a, b))
        .map(str::to_owned);
    let status_label = if blocked > 0 {
        "blocked".to_owned()
    } else if upcoming_due > 0 {
        format!("{upcoming_due} due soon")
    } else {
        "on track".to_owned()
    };
    SuperviseeCounts {
        milestones_total: milestones.len() as u64,
        milestones_done: count(milestones, |m| m.status == "done"),
        blocked,
        upcoming_due,
        last_log_date,
        status_label,
    }
}

/// Name for a label: full name, then email, then `Unknown`.
fn member_name(member: &StatMember) -> &str {
    [member.full_name.as_deref(), member.email.as_deref()]
        .into_iter()
        .flatten()
        .find(|s| !s.is_empty())
        .unwrap_or("Unknown")
}

/// Blocked milestones and open milestones past their target, per supervisee, in input order.
#[must_use]
pub fn team_attention(supervisees: &[StatSupervisee], today: &str) -> Vec<TeamAttentionItem> {
    let mut items = Vec::new();
    for s in supervisees {
        let name = member_name(&s.member);
        let href = format!("/supervision?member={}", s.member.id);
        for m in &s.milestones {
            let label = if m.status == "blocked" {
                format!("{name}: {} (blocked)", m.title)
            } else if m.status != "done" {
                match target(m) {
                    Some(d) if d < today => format!("{name}: {} (overdue {d})", m.title),
                    _ => continue,
                }
            } else {
                continue;
            };
            items.push(TeamAttentionItem {
                member_id: s.member.id.clone(),
                member_name: name.to_owned(),
                label,
                href: href.clone(),
            });
        }
    }
    items
}

/// A log entry as the dashboard reads it: the date, creation stamp and body for the preview.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatLogEntry {
    /// Entry id, used as the React key.
    pub id: String,
    /// `yyyy-mm-dd`.
    pub entry_date: String,
    /// Creation timestamp; breaks ties between entries on the same day.
    pub created_at: String,
    /// Markdown body, reduced to a plain-text preview.
    pub body: String,
}

/// A report section, reduced to the status the progress reads.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatSection {
    /// `done` or another status.
    pub status: String,
}

/// Everything the dashboard stats are built from.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatsInput {
    /// Library papers.
    pub papers: Vec<StatPaper>,
    /// Report sections.
    pub sections: Vec<StatSection>,
    /// Plan milestones.
    pub milestones: Vec<StatMilestone>,
    /// Experiments.
    pub experiments: Vec<StatExperiment>,
    /// Log entries; only the newest few are shown.
    pub log_entries: Vec<StatLogEntry>,
    /// Number of paper relations (the graph edge count).
    pub relation_count: usize,
    /// Number of paper lists.
    pub list_count: usize,
    /// Tags with their paper counts.
    pub tags: Vec<StatTag>,
}

/// Done count, total, and whole percentage for one progress bar.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Progress {
    /// Items marked done.
    pub done: usize,
    /// All items.
    pub total: usize,
    /// `done / total` rounded to a whole percent; 0 when there are no items.
    pub pct: usize,
}

/// Experiments progress plus the running count.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentsStat {
    /// Experiments marked done.
    pub done: usize,
    /// All experiments.
    pub total: usize,
    /// Done share as a whole percent.
    pub pct: usize,
    /// Experiments still running.
    pub running: usize,
}

/// One recent log line on the dashboard.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentLogItem {
    /// Entry id.
    pub id: String,
    /// Entry date, `yyyy-mm-dd`.
    pub date: String,
    /// Plain-text preview of the body.
    pub preview: String,
    /// App route the line links to.
    pub href: String,
}

/// Library counts shown in the snapshot card.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySnapshot {
    /// Number of papers.
    pub papers: usize,
    /// Number of relations between papers.
    pub edges: usize,
    /// Number of lists.
    pub lists: usize,
    /// App route the card links to.
    pub href: String,
}

/// The whole dashboard stats object.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardStats {
    /// Reading progress over papers.
    pub reading: Progress,
    /// Report progress over sections.
    pub report: Progress,
    /// Plan progress over milestones.
    pub plan: Progress,
    /// Experiments progress and running count.
    pub experiments: ExperimentsStat,
    /// Attention lines, in display order.
    pub attention: Vec<AttentionItem>,
    /// The newest log lines, at most five.
    pub recent_log: Vec<RecentLogItem>,
    /// Library counts.
    pub library: LibrarySnapshot,
    /// The three most-used tags.
    pub top_tags: Vec<TopTag>,
}

/// How many of `items` are done, and that as a whole percentage.
fn progress_of<T>(items: &[T], is_done: impl Fn(&T) -> bool) -> Progress {
    let total = items.len();
    let done = items.iter().filter(|item| is_done(item)).count();
    Progress {
        done,
        total,
        pct: percent(done, total),
    }
}

/// `done / total` as a whole percent, rounded half up like `Math.round`; 0 for no items.
// A rounded percentage of two counts: non-negative and small, so the cast is exact.
#[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
fn percent(done: usize, total: usize) -> usize {
    if total == 0 {
        return 0;
    }
    ((done as f64 / total as f64) * 100.0).round() as usize
}

/// Experiments progress with the running count.
fn experiments_summary(experiments: &[StatExperiment]) -> ExperimentsStat {
    let running = experiments.iter().filter(|e| e.status == "running").count();
    let progress = progress_of(experiments, |e| e.status == "done");
    ExperimentsStat {
        done: progress.done,
        total: progress.total,
        pct: progress.pct,
        running,
    }
}

/// The newest `limit` log entries, newest date first, then newest creation stamp.
fn recent_log_entries(entries: &[StatLogEntry], limit: usize) -> Vec<RecentLogItem> {
    let mut sorted: Vec<&StatLogEntry> = entries.iter().collect();
    sorted.sort_by(|a, b| {
        b.entry_date
            .cmp(&a.entry_date)
            .then_with(|| b.created_at.cmp(&a.created_at))
    });
    sorted
        .into_iter()
        .take(limit)
        .map(|e| RecentLogItem {
            id: e.id.clone(),
            date: e.entry_date.clone(),
            // The same plain-text preview the note and paper cards show.
            preview: crate::card_snippet::card_snippet(&e.body, 80),
            href: "/log".into(),
        })
        .collect()
}

/// Build the whole dashboard stats object for `today` (`yyyy-mm-dd`).
#[must_use]
pub fn build_dashboard_stats(input: &StatsInput, today: &str) -> DashboardStats {
    DashboardStats {
        reading: progress_of(&input.papers, |p| p.status == "read"),
        report: progress_of(&input.sections, |s| s.status == "done"),
        plan: progress_of(&input.milestones, |m| m.status == "done"),
        experiments: experiments_summary(&input.experiments),
        attention: needs_attention(&input.papers, &input.milestones, &input.experiments, today),
        recent_log: recent_log_entries(&input.log_entries, 5),
        library: LibrarySnapshot {
            papers: input.papers.len(),
            edges: input.relation_count,
            lists: input.list_count,
            href: "/graph".into(),
        },
        top_tags: top_tags(&input.tags, 3),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn paper(status: &str) -> StatPaper {
        StatPaper {
            status: status.into(),
        }
    }

    fn milestone(title: &str, status: &str, target: Option<&str>) -> StatMilestone {
        StatMilestone {
            title: title.into(),
            status: status.into(),
            target_date: target.map(str::to_owned),
        }
    }

    fn member(id: &str, name: Option<&str>, email: Option<&str>) -> StatMember {
        StatMember {
            id: id.into(),
            full_name: name.map(str::to_owned),
            email: email.map(str::to_owned),
        }
    }

    #[test]
    fn needs_attention_lists_unread_overdue_due_and_running() {
        let items = needs_attention(
            &[paper("read"), paper("reading"), paper("unread")],
            &[
                milestone("Draft", "todo", Some("2026-11-01")),
                milestone("Review", "todo", Some("2026-11-20")),
                milestone("Done", "done", Some("2026-11-01")),
                milestone("Later", "todo", Some("2027-01-01")),
            ],
            &[StatExperiment {
                status: "running".into(),
            }],
            "2026-11-10",
        );
        let labels: Vec<&str> = items.iter().map(|i| i.label.as_str()).collect();
        assert_eq!(
            labels,
            [
                "2 papers unread",
                "Milestone overdue (2026-11-01): Draft",
                "Milestone due 2026-11-20: Review",
                "1 experiment running",
            ]
        );
    }

    #[test]
    fn top_tags_sorts_by_count_then_name() {
        let tags = [
            StatTag {
                name: "b".into(),
                paper_count: 2,
            },
            StatTag {
                name: "a".into(),
                paper_count: 2,
            },
            StatTag {
                name: "c".into(),
                paper_count: 5,
            },
            StatTag {
                name: "d".into(),
                paper_count: 1,
            },
        ];
        let names: Vec<(String, u64)> = top_tags(&tags, 3)
            .into_iter()
            .map(|t| (t.name, t.count))
            .collect();
        assert_eq!(names, [("c".into(), 5), ("a".into(), 2), ("b".into(), 2)]);
    }

    #[test]
    fn supervisee_counts_prefers_blocked_label() {
        let counts = supervisee_counts(
            &[
                milestone("x", "blocked", None),
                milestone("y", "todo", Some("2026-11-12")),
            ],
            &[
                StatLog {
                    entry_date: "2026-11-01".into(),
                },
                StatLog {
                    entry_date: "2026-11-05".into(),
                },
            ],
            "2026-11-10",
        );
        assert_eq!(counts.blocked, 1);
        assert_eq!(counts.upcoming_due, 1);
        assert_eq!(counts.last_log_date.as_deref(), Some("2026-11-05"));
        assert_eq!(counts.status_label, "blocked");
    }

    #[test]
    fn team_attention_uses_name_fallbacks() {
        let items = team_attention(
            &[
                StatSupervisee {
                    member: member("m1", Some(""), Some("a@x.org")),
                    milestones: vec![milestone("Ch 1", "blocked", None)],
                    logs: vec![],
                },
                StatSupervisee {
                    member: member("m2", None, None),
                    milestones: vec![milestone("Ch 2", "todo", Some("2026-10-01"))],
                    logs: vec![],
                },
            ],
            "2026-11-10",
        );
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].member_name, "a@x.org");
        assert_eq!(items[0].label, "a@x.org: Ch 1 (blocked)");
        assert_eq!(items[1].member_name, "Unknown");
        assert_eq!(items[1].label, "Unknown: Ch 2 (overdue 2026-10-01)");
        assert_eq!(items[1].href, "/supervision?member=m2");
    }
}
