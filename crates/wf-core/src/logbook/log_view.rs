//! List helpers for the logbook screen and the past check-ins list (TS
//! `logbook-screen.tsx` and `past-check-ins.tsx`): grouping entries by day, an entry's
//! headline, the streak and eyebrow line, and the newest-first order.
//!
//! Clock-free and locale-free. The caller passes today as `yyyy-mm-dd` (the local calendar
//! day) and the entry dates as plain strings. Results point back at the caller's list by
//! index, so each side keeps its own row objects.

use std::collections::{BTreeMap, HashSet};

/// Entries on one calendar day, as indexes into the caller's list.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[cfg_attr(feature = "specta", serde(rename = "LogDayGroup"))]
pub struct DayGroup {
    /// The day, `yyyy-mm-dd`.
    pub day: String,
    /// Indexes of the day's entries, in the order they arrived.
    pub indexes: Vec<u32>,
}

/// An entry's card title and the text under it.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[cfg_attr(feature = "specta", serde(rename = "LogHeadlineSplit"))]
pub struct HeadlineSplit {
    /// The first line without heading and emphasis marks, or "Untitled entry".
    pub headline: String,
    /// Everything after the first line, trimmed. Empty for a one-line entry.
    pub rest: String,
}

/// Entries grouped by day, newest day first. Entries keep their arrival order within a day.
#[must_use]
pub fn group_by_day(entry_dates: &[String]) -> Vec<DayGroup> {
    let mut by_day: BTreeMap<&str, Vec<u32>> = BTreeMap::new();
    for (index, date) in entry_dates.iter().enumerate() {
        by_day
            .entry(date.as_str())
            .or_default()
            .push(u32::try_from(index).unwrap_or(u32::MAX));
    }
    by_day
        .into_iter()
        .rev()
        .map(|(day, indexes)| DayGroup {
            day: day.to_owned(),
            indexes,
        })
        .collect()
}

/// The first line becomes the headline, the rest the text. Heading marks and emphasis are dropped.
#[must_use]
pub fn split_headline(body: &str) -> HeadlineSplit {
    let trimmed = body.trim();
    let (first, rest) = match trimmed.split_once('\n') {
        Some((first, rest)) => (first, rest.trim()),
        None => (trimmed, ""),
    };
    let headline = strip_emphasis(first.trim_start_matches('#').trim_start());
    HeadlineSplit {
        headline: if headline.is_empty() {
            "Untitled entry".to_owned()
        } else {
            headline
        },
        rest: rest.to_owned(),
    }
}

/// Consecutive days with an entry, counting back from `today`, or from yesterday when
/// today has none.
#[must_use]
pub fn streak_days(entry_dates: &[String], today: &str) -> u32 {
    let logged: HashSet<&str> = entry_dates.iter().map(String::as_str).collect();
    let mut day = today.to_owned();
    if !logged.contains(day.as_str()) {
        match previous_day(&day) {
            Some(previous) => day = previous,
            None => return 0,
        }
    }
    let mut streak = 0;
    while logged.contains(day.as_str()) {
        streak += 1;
        match previous_day(&day) {
            Some(previous) => day = previous,
            None => break,
        }
    }
    streak
}

/// "62 entries · 9-day streak" above the title, or `None` when there are no entries.
#[must_use]
pub fn log_eyebrow(entry_dates: &[String], today: &str) -> Option<String> {
    if entry_dates.is_empty() {
        return None;
    }
    let count = format!(
        "{} {}",
        entry_dates.len(),
        if entry_dates.len() == 1 {
            "entry"
        } else {
            "entries"
        }
    );
    let streak = streak_days(entry_dates, today);
    Some(if streak > 1 {
        format!("{count} · {streak}-day streak")
    } else {
        count
    })
}

/// Indexes of the stamps, latest first. Equal stamps keep their input order.
#[must_use]
pub fn newest_first_order(published_at: &[String]) -> Vec<u32> {
    let mut order: Vec<usize> = (0..published_at.len()).collect();
    order.sort_by(|a, b| published_at[*b].cmp(&published_at[*a]));
    order
        .into_iter()
        .map(|index| u32::try_from(index).unwrap_or(u32::MAX))
        .collect()
}

/// Markers stripped from a headline, in the order the match tries them.
const EMPHASIS_MARKERS: [&str; 4] = ["**", "__", "*", "`"];

/// Keep the text inside `**x**`, `__x__`, `*x*` and `` `x` `` (the first closing marker wins).
fn strip_emphasis(text: &str) -> String {
    let mut out = String::new();
    let mut index = 0;
    while index < text.len() {
        let rest = &text[index..];
        let matched = EMPHASIS_MARKERS.iter().find_map(|marker| {
            rest.starts_with(marker)
                .then(|| closing_marker(text, index + marker.len(), marker))
                .flatten()
                .map(|close| (marker.len(), close))
        });
        match matched {
            Some((marker_len, close)) => {
                out.push_str(&text[index + marker_len..close]);
                index = close + marker_len;
            }
            None => {
                let ch = rest.chars().next().unwrap_or_default();
                out.push(ch);
                index += ch.len_utf8();
            }
        }
    }
    out
}

/// The start of the first `marker` after at least one character of content from `from`,
/// on the same line. `None` when no closing marker follows.
fn closing_marker(text: &str, from: usize, marker: &str) -> Option<usize> {
    let first = text[from..].chars().next()?;
    if is_line_break(first) {
        return None;
    }
    let mut at = from + first.len_utf8();
    loop {
        if text[at..].starts_with(marker) {
            return Some(at);
        }
        let ch = text[at..].chars().next()?;
        if is_line_break(ch) {
            return None;
        }
        at += ch.len_utf8();
    }
}

/// The characters a JS `.` does not match.
fn is_line_break(ch: char) -> bool {
    matches!(ch, '\n' | '\r' | '\u{2028}' | '\u{2029}')
}

/// The calendar day before a `yyyy-mm-dd` date, or `None` when the date does not parse.
fn previous_day(ymd: &str) -> Option<String> {
    let mut parts = ymd.split('-');
    let year: i32 = parts.next()?.parse().ok()?;
    let month: u32 = parts.next()?.parse().ok()?;
    let day: u32 = parts.next()?.parse().ok()?;
    if parts.next().is_some()
        || !(1..=12).contains(&month)
        || day == 0
        || day > days_in_month(year, month)
    {
        return None;
    }
    let (year, month, day) = if day > 1 {
        (year, month, day - 1)
    } else if month > 1 {
        (year, month - 1, days_in_month(year, month - 1))
    } else {
        (year - 1, 12, 31)
    };
    Some(format!("{year:04}-{month:02}-{day:02}"))
}

/// Days in `month` (1-12) of `year`, leap years included.
fn days_in_month(year: i32, month: u32) -> u32 {
    match month {
        2 if is_leap_year(year) => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    }
}

/// Gregorian leap year.
fn is_leap_year(year: i32) -> bool {
    (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dates(list: &[&str]) -> Vec<String> {
        list.iter().map(|d| (*d).to_owned()).collect()
    }

    #[test]
    fn groups_newest_day_first_and_keeps_arrival_order() {
        let groups = group_by_day(&dates(&["2026-11-09", "2026-11-10", "2026-11-09"]));
        assert_eq!(
            groups,
            vec![
                DayGroup {
                    day: "2026-11-10".to_owned(),
                    indexes: vec![1],
                },
                DayGroup {
                    day: "2026-11-09".to_owned(),
                    indexes: vec![0, 2],
                },
            ]
        );
    }

    #[test]
    fn headline_drops_heading_and_emphasis_and_keeps_rest() {
        let split = split_headline("## **Hello** world\n\n  body text  ");
        assert_eq!(split.headline, "Hello world");
        assert_eq!(split.rest, "body text");
    }

    #[test]
    fn headline_strips_code_and_underscore_emphasis() {
        assert_eq!(
            split_headline("`code` and __bold__").headline,
            "code and bold"
        );
    }

    #[test]
    fn unclosed_marker_stays_and_empty_body_is_untitled() {
        assert_eq!(split_headline("a *b").headline, "a *b");
        assert_eq!(split_headline("**").headline, "**");
        assert_eq!(split_headline("   ").headline, "Untitled entry");
    }

    #[test]
    fn streak_counts_back_from_today_or_yesterday() {
        let logged = dates(&["2026-11-10", "2026-11-09", "2026-11-08"]);
        assert_eq!(streak_days(&logged, "2026-11-10"), 3);
        assert_eq!(
            streak_days(&dates(&["2026-11-09", "2026-11-08"]), "2026-11-10"),
            2
        );
        assert_eq!(
            streak_days(&dates(&["2026-11-10", "2026-11-08"]), "2026-11-10"),
            1
        );
        assert_eq!(streak_days(&[], "2026-11-10"), 0);
    }

    #[test]
    fn streak_crosses_month_and_leap_day() {
        let month = dates(&["2026-03-01", "2026-02-28", "2026-02-27"]);
        assert_eq!(streak_days(&month, "2026-03-01"), 3);
        let leap = dates(&["2028-03-01", "2028-02-29"]);
        assert_eq!(streak_days(&leap, "2028-03-01"), 2);
    }

    #[test]
    fn eyebrow_counts_entries_and_long_streaks() {
        assert_eq!(log_eyebrow(&[], "2026-11-10"), None);
        assert_eq!(
            log_eyebrow(&dates(&["2026-11-10"]), "2026-11-10").as_deref(),
            Some("1 entry")
        );
        assert_eq!(
            log_eyebrow(
                &dates(&["2026-11-10", "2026-11-09", "2026-11-08"]),
                "2026-11-10"
            )
            .as_deref(),
            Some("3 entries · 3-day streak")
        );
        assert_eq!(
            log_eyebrow(&dates(&["2026-11-10", "2026-11-08"]), "2026-11-10").as_deref(),
            Some("2 entries")
        );
    }

    #[test]
    fn newest_first_order_is_stable_for_equal_stamps() {
        let stamps = dates(&[
            "2026-01-01T00:00:00Z",
            "2026-03-01T00:00:00Z",
            "2026-03-01T00:00:00Z",
        ]);
        assert_eq!(newest_first_order(&stamps), vec![1, 2, 0]);
    }
}
