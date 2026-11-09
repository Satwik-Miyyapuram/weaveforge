//! Plan feed: an iCalendar of dated milestones and a JSON summary for widgets. Pure; no I/O.

use crate::sync::instant::format_instant;

const DAY_MS: i64 = 86_400_000;
const DEFAULT_WIDGET_LIMIT: usize = 20;

/// A milestone as the feed sees it: the fields it reads, plus its project name.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct FeedMilestone {
    /// Milestone id; the calendar UID and the widget id.
    pub id: String,
    /// Display title.
    pub title: String,
    /// Optional free-text description.
    #[serde(default)]
    pub description: Option<String>,
    /// `planned`, `in_progress`, `blocked` or `done`; anything else counts as planned.
    pub status: String,
    /// `yyyy-mm-dd`, or `None` when undated.
    #[serde(default)]
    pub target_date: Option<String>,
    /// Name of the owning project, when the project is live.
    #[serde(default)]
    pub project_name: Option<String>,
}

/// `yyyy-mm-dd` to days since 1970-01-01, or `None` unless it is a real calendar date.
fn parse_date(value: Option<&str>) -> Option<i64> {
    let b = value?.as_bytes();
    if b.len() != 10 || b.get(4) != Some(&b'-') || b.get(7) != Some(&b'-') {
        return None;
    }
    let year = digits(b.get(0..4)?)?;
    let month = digits(b.get(5..7)?)?;
    let day = digits(b.get(8..10)?)?;
    let days = days_from_civil(year, month, day);
    // Rejects 2026-02-31, which would roll into March.
    (civil_from_days(days).1 == month).then_some(days)
}

fn digits(bytes: &[u8]) -> Option<i64> {
    bytes.iter().try_fold(0_i64, |acc, &b| {
        b.is_ascii_digit().then(|| acc * 10 + i64::from(b - b'0'))
    })
}

/// Howard Hinnant's `days_from_civil`.
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let y = if month <= 2 { year - 1 } else { year };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = if month > 2 { month - 3 } else { month + 9 };
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// Howard Hinnant's `civil_from_days`: (year, month, day).
fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

fn iso_day(days: i64) -> String {
    let (y, m, d) = civil_from_days(days);
    format!("{y:04}-{m:02}-{d:02}")
}

fn ics_day(days: i64) -> String {
    let (y, m, d) = civil_from_days(days);
    format!("{y:04}{m:02}{d:02}")
}

/// Dated milestones as days since epoch, soonest first then by id; done ones only when asked.
fn deadlines(items: &[FeedMilestone], include_done: bool) -> Vec<(i64, &FeedMilestone)> {
    let mut out: Vec<(i64, &FeedMilestone)> = items
        .iter()
        .filter_map(|item| parse_date(item.target_date.as_deref()).map(|days| (days, item)))
        .filter(|(_, item)| include_done || item.status != "done")
        .collect();
    out.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.id.cmp(&b.1.id)));
    out
}

/// TEXT escaping: backslash, semicolon, comma and line breaks.
#[must_use]
pub fn escape_ics_text(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace(';', "\\;")
        .replace(',', "\\,")
        .replace("\r\n", "\\n")
        .replace(['\r', '\n'], "\\n")
}

/// Folds a content line at 75 UTF-8 bytes (74 after the first fold), never splitting a character.
#[must_use]
pub fn fold_ics_line(line: &str) -> String {
    let mut parts: Vec<String> = Vec::new();
    let mut current = String::new();
    let mut bytes = 0_usize;
    for ch in line.chars() {
        let size = ch.len_utf8();
        let limit = if parts.is_empty() { 75 } else { 74 };
        if bytes + size > limit {
            parts.push(std::mem::take(&mut current));
            bytes = 0;
        }
        current.push(ch);
        bytes += size;
    }
    parts.push(current);
    parts.join("\r\n ")
}

/// `yyyymmddThhmmssZ` for the instant, without the milliseconds.
fn dtstamp(now_ms: i64) -> String {
    let base: String = format_instant(now_ms)
        .replace(['-', ':'], "")
        .chars()
        .take(15)
        .collect();
    format!("{base}Z")
}

fn status_prefix(status: &str) -> &'static str {
    match status {
        "done" => "✓",
        "blocked" => "⚑ Blocked:",
        _ => "⚑",
    }
}

/// The deadlines as an iCalendar document: one all-day event per dated milestone, UID = milestone id.
#[must_use]
pub fn milestones_to_ics(
    items: &[FeedMilestone],
    include_done: bool,
    reminder_days: i64,
    now_ms: i64,
) -> String {
    let stamp = dtstamp(now_ms);
    let reminder = reminder_days.max(0);
    let mut lines: Vec<String> = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//WeaveForge//Plan deadlines//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "X-WR-CALNAME:WeaveForge deadlines",
        "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
        "X-PUBLISHED-TTL:PT1H",
    ]
    .iter()
    .map(|line| (*line).to_owned())
    .collect();
    for (days, item) in deadlines(items, include_done) {
        let summary = format!("{} {}", status_prefix(&item.status), item.title);
        lines.push("BEGIN:VEVENT".to_owned());
        lines.push(format!("UID:{}@weaveforge.org", item.id));
        lines.push(format!("DTSTAMP:{stamp}"));
        lines.push(format!("DTSTART;VALUE=DATE:{}", ics_day(days)));
        lines.push(format!("DTEND;VALUE=DATE:{}", ics_day(days + 1)));
        lines.push(format!("SUMMARY:{}", escape_ics_text(&summary)));
        lines.push("TRANSP:TRANSPARENT".to_owned());
        if let Some(description) = item
            .description
            .as_deref()
            .map(str::trim)
            .filter(|d| !d.is_empty())
        {
            lines.push(format!("DESCRIPTION:{}", escape_ics_text(description)));
        }
        if let Some(project) = project_label(item.project_name.as_deref()) {
            lines.push(format!("CATEGORIES:{}", escape_ics_text(project)));
        }
        if reminder > 0 && item.status != "done" {
            lines.push("BEGIN:VALARM".to_owned());
            lines.push("ACTION:DISPLAY".to_owned());
            lines.push(format!("DESCRIPTION:{}", escape_ics_text(&item.title)));
            lines.push(format!("TRIGGER:-P{reminder}D"));
            lines.push("END:VALARM".to_owned());
        }
        lines.push("END:VEVENT".to_owned());
    }
    lines.push("END:VCALENDAR".to_owned());
    let folded: Vec<String> = lines
        .iter()
        .map(|line| fold_ics_line(line.as_str()))
        .collect();
    format!("{}\r\n", folded.join("\r\n"))
}

/// The trimmed project name, or `None` when there is no usable one.
fn project_label(name: Option<&str>) -> Option<&str> {
    name.map(str::trim).filter(|n| !n.is_empty())
}

/// One deadline as a widget draws it.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct PlanWidgetItem {
    /// Milestone id.
    pub id: String,
    /// Display title.
    pub title: String,
    /// Trimmed project name, or `None`.
    pub project: Option<String>,
    /// `yyyy-mm-dd`.
    pub date: String,
    /// The milestone's status.
    pub status: String,
    /// Whole days from `today` to `date`; negative when overdue.
    pub days_left: i32,
}

/// The JSON summary a home-screen or desktop widget reads.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct PlanWidgetData {
    /// Always 1.
    pub version: u32,
    /// When the summary was built, as an ISO instant.
    pub generated_at: String,
    /// The UTC day `daysLeft` counts from.
    pub today: String,
    /// The deadlines shown, soonest first.
    pub items: Vec<PlanWidgetItem>,
    /// Open milestones past their date.
    pub overdue: u32,
    /// Open milestones with no date.
    pub undated: u32,
}

/// [`plan_widget`] as a JSON value, for the server route and the shell command.
#[must_use]
pub fn plan_widget_data(
    items: &[FeedMilestone],
    include_done: bool,
    limit: Option<usize>,
    now_ms: i64,
) -> serde_json::Value {
    serde_json::to_value(plan_widget(items, include_done, limit, now_ms)).unwrap_or_default()
}

/// The deadlines a widget draws (soonest first, overdue included) plus overdue and undated counts.
#[must_use]
pub fn plan_widget(
    items: &[FeedMilestone],
    include_done: bool,
    limit: Option<usize>,
    now_ms: i64,
) -> PlanWidgetData {
    let today = now_ms.div_euclid(DAY_MS);
    let dated = deadlines(items, include_done);
    let overdue = dated
        .iter()
        .filter(|(days, item)| *days < today && item.status != "done")
        .count();
    let undated = items
        .iter()
        .filter(|item| parse_date(item.target_date.as_deref()).is_none() && item.status != "done")
        .count();
    let items: Vec<PlanWidgetItem> = dated
        .iter()
        .take(limit.unwrap_or(DEFAULT_WIDGET_LIMIT).max(1))
        .map(|(days, item)| PlanWidgetItem {
            id: item.id.clone(),
            title: item.title.clone(),
            project: project_label(item.project_name.as_deref()).map(str::to_owned),
            date: iso_day(*days),
            status: item.status.clone(),
            days_left: i32::try_from(*days - today).unwrap_or(i32::MAX),
        })
        .collect();
    PlanWidgetData {
        version: 1,
        generated_at: format_instant(now_ms),
        today: iso_day(today),
        items,
        overdue: u32::try_from(overdue).unwrap_or(u32::MAX),
        undated: u32::try_from(undated).unwrap_or(u32::MAX),
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;
    use serde_json::json;

    /// 2026-09-26T10:30:00Z.
    const NOW_MS: i64 = 1_790_418_600_000;

    fn item(id: &str, target: Option<&str>, status: &str) -> FeedMilestone {
        FeedMilestone {
            id: id.to_owned(),
            title: format!("Milestone {id}"),
            description: None,
            status: status.to_owned(),
            target_date: target.map(str::to_owned),
            project_name: None,
        }
    }

    #[test]
    fn escapes_ics_text_specials() {
        assert_eq!(
            escape_ics_text("a\\b;c,d\ne\r\nf\rg"),
            "a\\\\b\\;c\\,d\\ne\\nf\\ng"
        );
    }

    #[test]
    fn folds_ascii_at_75_then_74() {
        let folded = fold_ics_line(&"x".repeat(80));
        assert_eq!(folded, format!("{}\r\n {}", "x".repeat(75), "x".repeat(5)));
        assert_eq!(fold_ics_line("SHORT:ok"), "SHORT:ok");
    }

    #[test]
    fn folds_multibyte_without_splitting_a_character() {
        // 74 ASCII bytes, then a 2-byte char that would reach 76 on the first line.
        let line = format!("{}é{}", "a".repeat(74), "b");
        assert_eq!(fold_ics_line(&line), format!("{}\r\n éb", "a".repeat(74)));
    }

    #[test]
    fn done_milestones_only_with_include_done() {
        let items = [
            item("a", Some("2026-10-01"), "planned"),
            item("d", Some("2026-09-01"), "done"),
        ];
        let open = milestones_to_ics(&items, false, 0, NOW_MS);
        assert_eq!(open.matches("BEGIN:VEVENT").count(), 1);
        let all = milestones_to_ics(&items, true, 0, NOW_MS);
        assert_eq!(all.matches("BEGIN:VEVENT").count(), 2);
        assert!(all.contains("SUMMARY:✓ Milestone d"));
    }

    #[test]
    fn valarm_only_for_open_milestones_with_reminder_days() {
        let items = [
            item("m", Some("2026-12-31"), "planned"),
            item("d", Some("2026-11-01"), "done"),
        ];
        let ics = milestones_to_ics(&items, true, 2, NOW_MS);
        assert_eq!(ics.matches("BEGIN:VALARM").count(), 1);
        assert!(ics.contains("TRIGGER:-P2D"));
        assert!(!milestones_to_ics(&items, true, 0, NOW_MS).contains("VALARM"));
    }

    #[test]
    fn envelope_stamp_and_month_rollover() {
        let ics = milestones_to_ics(
            &[item("m", Some("2026-12-31"), "planned")],
            false,
            0,
            NOW_MS,
        );
        assert!(ics.starts_with("BEGIN:VCALENDAR\r\n"));
        assert!(ics.ends_with("END:VCALENDAR\r\n"));
        assert!(ics.contains("DTSTAMP:20260926T103000Z\r\n"));
        assert!(ics.contains("DTSTART;VALUE=DATE:20261231\r\nDTEND;VALUE=DATE:20270101"));
        assert!(ics.contains("UID:m@weaveforge.org\r\n"));
    }

    #[test]
    fn blocked_prefix() {
        let ics = milestones_to_ics(
            &[item("b", Some("2026-10-01"), "blocked")],
            false,
            0,
            NOW_MS,
        );
        assert!(ics.contains("SUMMARY:⚑ Blocked: Milestone b\r\n"));
    }

    #[test]
    fn invalid_dates_are_dropped() {
        let items = [
            item("bad1", Some("2026-02-31"), "planned"),
            item("bad2", Some("2026-1-1"), "planned"),
            item("bad3", Some("2026-02-29"), "planned"),
            item("ok", Some("2028-02-29"), "planned"),
        ];
        let ics = milestones_to_ics(&items, false, 0, NOW_MS);
        assert_eq!(ics.matches("BEGIN:VEVENT").count(), 1);
        assert!(ics.contains("UID:ok@weaveforge.org"));
    }

    #[test]
    fn two_digit_years_are_not_shifted_to_1900s() {
        let items = [item("early", Some("0050-01-01"), "planned")];
        let ics = milestones_to_ics(&items, false, 0, NOW_MS);
        assert!(ics.contains("DTSTART;VALUE=DATE:00500101"), "{ics}");
    }

    #[test]
    fn widget_counts_overdue_and_undated_and_orders_by_date() {
        let items = [
            item("late", Some("2026-09-20"), "planned"),
            FeedMilestone {
                project_name: Some(" Lab ".to_owned()),
                ..item("soon", Some("2026-09-29"), "in_progress")
            },
            item("open", None, "planned"),
            item("closed", None, "done"),
        ];
        let data = plan_widget_data(&items, false, None, NOW_MS);
        assert_eq!(data["version"], json!(1));
        assert_eq!(data["generatedAt"], json!("2026-09-26T10:30:00.000Z"));
        assert_eq!(data["today"], json!("2026-09-26"));
        assert_eq!(data["items"].as_array().map(Vec::len), Some(2));
        assert_eq!(data["items"][0]["id"], json!("late"));
        assert_eq!(data["items"][0]["daysLeft"], json!(-6));
        assert_eq!(data["items"][0]["project"], json!(null));
        assert_eq!(data["items"][1]["project"], json!("Lab"));
        assert_eq!(data["items"][1]["daysLeft"], json!(3));
        assert_eq!(data["items"][1]["date"], json!("2026-09-29"));
        assert_eq!(data["overdue"], json!(1));
        assert_eq!(data["undated"], json!(1));
    }

    #[test]
    fn widget_limit_defaults_to_20_and_has_minimum_1() {
        let items: Vec<FeedMilestone> = (0..25)
            .map(|i| item(&format!("m{i:02}"), Some("2026-10-01"), "planned"))
            .collect();
        assert_eq!(
            plan_widget_data(&items, false, None, NOW_MS)["items"]
                .as_array()
                .map(Vec::len),
            Some(20)
        );
        assert_eq!(
            plan_widget_data(&items, false, Some(0), NOW_MS)["items"]
                .as_array()
                .map(Vec::len),
            Some(1)
        );
        assert_eq!(
            plan_widget_data(&items, false, Some(3), NOW_MS)["items"]
                .as_array()
                .map(Vec::len),
            Some(3)
        );
    }

    #[test]
    fn same_date_sorts_by_id() {
        let items = [
            item("b", Some("2026-10-01"), "planned"),
            item("a", Some("2026-10-01"), "planned"),
        ];
        let data = plan_widget_data(&items, false, None, NOW_MS);
        assert_eq!(data["items"][0]["id"], json!("a"));
        assert_eq!(data["items"][1]["id"], json!("b"));
    }
}
