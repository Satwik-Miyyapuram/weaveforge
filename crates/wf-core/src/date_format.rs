//! UI date formats (ports `formatDate`, `formatDateTime` and `formatRelative` in
//! `apps/web/src/lib/parts-1.ts`): "1 Jul 2026", "1 Jul 2026, 14:05", and "2h ago" for
//! activity under a week old. ISO text stays the form for inputs and exports.
//!
//! Inputs are ISO-8601 text. A value with no zone, and a bare `YYYY-MM-DD`, are local
//! time, so the caller passes the local offset in minutes east of UTC
//! (`-Date.getTimezoneOffset()`); Rust has no time-zone database. Anything that does
//! not parse formats to the empty string.

const MONTHS: [&str; 12] = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const MINUTE_MS: i64 = 60_000;
const HOUR_MS: i64 = 60 * MINUTE_MS;
const DAY_MS: i64 = 24 * HOUR_MS;

/// Days since 1970-01-01 of a proleptic Gregorian civil date.
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let y = if month <= 2 { year - 1 } else { year };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (month + 9) % 12;
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// The civil (year, month, day) of `days` since 1970-01-01.
fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

fn is_leap(year: i64) -> bool {
    (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
}

fn days_in_month(year: i64, month: i64) -> i64 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        _ if is_leap(year) => 29,
        _ => 28,
    }
}

/// Reads exactly `width` ASCII digits from `bytes` at `at`.
fn digits(bytes: &[u8], at: usize, width: usize) -> Option<i64> {
    let part = bytes.get(at..at + width)?;
    if !part.iter().all(u8::is_ascii_digit) {
        return None;
    }
    std::str::from_utf8(part).ok()?.parse().ok()
}

/// Parses `input` to milliseconds since the epoch. A bare date is local midnight; a
/// value with no zone is local time; `Z` and `±HH:MM` are explicit.
fn parse_ms(input: &str, offset_minutes: i32) -> Option<i64> {
    let bytes = input.as_bytes();
    let year = digits(bytes, 0, 4)?;
    if bytes.get(4) != Some(&b'-') {
        return None;
    }
    let month = digits(bytes, 5, 2)?;
    if bytes.get(7) != Some(&b'-') {
        return None;
    }
    let day = digits(bytes, 8, 2)?;
    if !(1..=12).contains(&month) || !(1..=days_in_month(year, month)).contains(&day) {
        return None;
    }
    let mut ms = days_from_civil(year, month, day) * DAY_MS;
    let mut at = 10;
    // A calendar day is local midnight, not UTC midnight.
    let zone_minutes: i64 = if at == bytes.len() {
        i64::from(offset_minutes)
    } else {
        if !matches!(bytes[at], b'T' | b't' | b' ') {
            return None;
        }
        let hour = digits(bytes, at + 1, 2)?;
        if bytes.get(at + 3) != Some(&b':') {
            return None;
        }
        let minute = digits(bytes, at + 4, 2)?;
        at += 6;
        let mut second = 0;
        if bytes.get(at) == Some(&b':') {
            second = digits(bytes, at + 1, 2)?;
            at += 3;
            if bytes.get(at) == Some(&b'.') {
                let start = at + 1;
                let mut end = start;
                while bytes.get(end).is_some_and(u8::is_ascii_digit) {
                    end += 1;
                }
                if end == start {
                    return None;
                }
                let fraction = &input[start..end.min(start + 3)];
                let scale = 10_i64.pow(3 - u32::try_from(fraction.len()).ok()?);
                ms += fraction.parse::<i64>().ok()? * scale;
                at = end;
            }
        }
        if hour > 23 || minute > 59 || second > 59 {
            return None;
        }
        ms += hour * HOUR_MS + minute * MINUTE_MS + second * 1000;
        match bytes.get(at) {
            None => i64::from(offset_minutes),
            Some(b'Z' | b'z') if at + 1 == bytes.len() => 0,
            Some(sign @ (b'+' | b'-')) => {
                let hh = digits(bytes, at + 1, 2)?;
                if bytes.get(at + 3) != Some(&b':') {
                    return None;
                }
                let mm = digits(bytes, at + 4, 2)?;
                if at + 6 != bytes.len() || hh > 23 || mm > 59 {
                    return None;
                }
                let total = hh * 60 + mm;
                if *sign == b'+' { total } else { -total }
            }
            Some(_) => return None,
        }
    };
    // Local wall-clock time minus the zone's offset is UTC.
    Some(ms - zone_minutes * MINUTE_MS)
}

/// The local wall-clock calendar date and time of `ms`.
fn local_parts(ms: i64, offset_minutes: i32) -> (i64, i64, i64, i64, i64) {
    let local = ms + i64::from(offset_minutes) * MINUTE_MS;
    let (year, month, day) = civil_from_days(local.div_euclid(DAY_MS));
    let in_day = local.rem_euclid(DAY_MS) / MINUTE_MS;
    (year, month, day, in_day / 60, in_day % 60)
}

fn date_of(ms: i64, offset_minutes: i32) -> String {
    let (year, month, day, _, _) = local_parts(ms, offset_minutes);
    format!(
        "{day} {} {year}",
        MONTHS[usize::try_from(month - 1).unwrap_or(0)]
    )
}

/// "1 Jul 2026" for `input`, or `""` when it does not parse.
#[must_use]
pub fn format_date(input: &str, offset_minutes: i32) -> String {
    parse_ms(input, offset_minutes).map_or_else(String::new, |ms| date_of(ms, offset_minutes))
}

/// "1 Jul 2026, 14:05" (24-hour clock) for `input`, or `""` when it does not parse.
#[must_use]
pub fn format_date_time(input: &str, offset_minutes: i32) -> String {
    parse_ms(input, offset_minutes).map_or_else(String::new, |ms| {
        let (_, _, _, hour, minute) = local_parts(ms, offset_minutes);
        format!("{}, {hour:02}:{minute:02}", date_of(ms, offset_minutes))
    })
}

/// "Just now", "5m ago", "2h ago", "3d ago" for activity under a week old, otherwise the
/// date. A clock a little ahead of `now_iso` also reads "Just now". `""` when `input` or
/// `now_iso` does not parse.
#[must_use]
pub fn format_relative(input: &str, now_iso: &str, offset_minutes: i32) -> String {
    let (Some(at), Some(now)) = (
        parse_ms(input, offset_minutes),
        parse_ms(now_iso, offset_minutes),
    ) else {
        return String::new();
    };
    let diff = now - at;
    if diff < MINUTE_MS {
        "Just now".to_owned()
    } else if diff < HOUR_MS {
        format!("{}m ago", diff / MINUTE_MS)
    } else if diff < DAY_MS {
        format!("{}h ago", diff / HOUR_MS)
    } else if diff < 7 * DAY_MS {
        format!("{}d ago", diff / DAY_MS)
    } else {
        date_of(at, offset_minutes)
    }
}

#[cfg(test)]
mod tests {
    use super::{format_date, format_date_time, format_relative};

    const NOW: &str = "2026-07-10T12:00:00";

    #[test]
    fn a_date_reads_day_short_month_year() {
        assert_eq!(format_date("2026-07-01", 0), "1 Jul 2026");
        assert_eq!(format_date("2025-12-18T09:30:00Z", 0), "18 Dec 2025");
    }

    #[test]
    fn a_date_and_time_uses_the_24_hour_clock() {
        assert_eq!(
            format_date_time("2026-07-01T14:05:00", 0),
            "1 Jul 2026, 14:05"
        );
    }

    #[test]
    fn missing_or_broken_input_shows_nothing() {
        for bad in [
            "",
            "not a date",
            "2026-13-01",
            "2026-02-30",
            "2026-07-01T25:00:00",
        ] {
            assert_eq!(format_date(bad, 0), "");
            assert_eq!(format_date_time(bad, 0), "");
            assert_eq!(format_relative(bad, NOW, 0), "");
        }
        assert_eq!(format_relative("2026-07-10T11:59:40", "not a date", 0), "");
    }

    #[test]
    fn recent_activity_reads_relative_older_falls_back_to_the_date() {
        assert_eq!(format_relative("2026-07-10T11:59:40", NOW, 0), "Just now");
        assert_eq!(format_relative("2026-07-10T11:55:00", NOW, 0), "5m ago");
        assert_eq!(format_relative("2026-07-10T10:00:00", NOW, 0), "2h ago");
        assert_eq!(format_relative("2026-07-07T12:00:00", NOW, 0), "3d ago");
        assert_eq!(format_relative("2026-07-01T12:00:00", NOW, 0), "1 Jul 2026");
    }

    #[test]
    fn a_clock_a_little_ahead_never_says_in_minutes() {
        assert_eq!(format_relative("2026-07-10T12:02:00", NOW, 0), "Just now");
    }

    #[test]
    fn a_date_only_value_is_that_calendar_day_in_any_timezone() {
        assert_eq!(format_date("2026-07-01", 0), "1 Jul 2026");
        assert_eq!(format_date("2026-07-01", -300), "1 Jul 2026");
        assert_eq!(format_date("2026-07-01", 840), "1 Jul 2026");
        assert_eq!(format_date("2026-12-31", 0), "31 Dec 2026");
    }

    #[test]
    fn a_value_with_no_zone_is_local_time() {
        // 14:05 local at +01:00 is 13:05 UTC; shown back at +01:00 it reads 14:05.
        assert_eq!(
            format_date_time("2026-07-01T14:05:00", 60),
            "1 Jul 2026, 14:05"
        );
        // The same instant shown at UTC reads 13:05.
        assert_eq!(
            format_date_time("2026-07-01T13:05:00Z", 0),
            "1 Jul 2026, 13:05"
        );
        assert_eq!(
            format_date_time("2026-07-01T13:05:00Z", 60),
            "1 Jul 2026, 14:05"
        );
    }

    #[test]
    fn the_offset_moves_the_calendar_day() {
        assert_eq!(format_date("2026-06-30T23:30:00Z", 0), "30 Jun 2026");
        assert_eq!(format_date("2026-06-30T23:30:00Z", 60), "1 Jul 2026");
    }

    #[test]
    fn an_explicit_zone_offset_is_applied() {
        assert_eq!(
            format_date_time("2026-07-01T14:05:00+02:00", 0),
            "1 Jul 2026, 12:05"
        );
        assert_eq!(
            format_date_time("2026-07-01T14:05:00.250-05:30", 0),
            "1 Jul 2026, 19:35"
        );
    }

    #[test]
    fn a_space_separates_date_and_time_and_fractions_are_read() {
        assert_eq!(format_date_time("2026-07-01 14:05", 0), "1 Jul 2026, 14:05");
        assert_eq!(
            format_relative("2026-07-10T11:59:40.999Z", NOW, 0),
            "Just now"
        );
    }
}
