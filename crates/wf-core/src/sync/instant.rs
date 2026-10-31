//! Port of the timestamp parsing `Date.parse` does for
//! `packages/core/src/shared/three-way-merge.ts`, limited to the grammar sync
//! rows use. Offsetless times are UTC here, not local time.

/// Epoch milliseconds for a timestamp in the accepted grammar, `None` otherwise.
#[must_use]
pub fn parse_instant(s: &str) -> Option<i64> {
    let b = s.as_bytes();
    let year = digits(b, 0, 4)?;
    if b.get(4) != Some(&b'-') || b.get(7) != Some(&b'-') {
        return None;
    }
    let month = digits(b, 5, 2)?;
    let day = digits(b, 8, 2)?;
    let sep = *b.get(10)?;
    if !matches!(sep, b'T' | b't' | b' ') {
        return None;
    }
    let hour = digits(b, 11, 2)?;
    if b.get(13) != Some(&b':') {
        return None;
    }
    let minute = digits(b, 14, 2)?;
    let mut i = 16;
    let mut second = 0;
    let has_seconds = b.get(i) == Some(&b':');
    if has_seconds {
        second = digits(b, i + 1, 2)?;
        i += 3;
    }
    let mut ms = 0;
    let mut has_fraction = false;
    // A fraction only follows seconds.
    if has_seconds && b.get(i) == Some(&b'.') {
        let (value, next) = fraction(b, i + 1)?;
        ms = value;
        i = next;
        has_fraction = true;
    }
    if !(1..=12).contains(&month)
        || !(1..=31).contains(&day)
        || hour > 24
        || minute > 59
        || second > 59
    {
        return None;
    }
    // Hour 24 is only the start of the next day, so it must be exactly that.
    if hour == 24 && (minute != 0 || second != 0 || ms != 0) {
        return None;
    }
    let offset = zone(b.get(i..)?, sep == b' ', has_fraction)?;
    // Day overflow rolls forward: day 30 of February is the first of March onward.
    let days = days_from_civil(year, month, 1) + day - 1;
    let clock = hour * 3_600_000 + minute * 60_000 + second * 1_000 + ms;
    Some(days * 86_400_000 + clock - offset * 60_000)
}

/// Reads exactly `n` ASCII digits at `at` as a number.
fn digits(b: &[u8], at: usize, n: usize) -> Option<i64> {
    let mut value = 0;
    for &c in b.get(at..at.checked_add(n)?)? {
        if !c.is_ascii_digit() {
            return None;
        }
        value = value * 10 + i64::from(c - b'0');
    }
    Some(value)
}

/// Milliseconds from the fraction digits starting at `start`, and where they end.
fn fraction(b: &[u8], start: usize) -> Option<(i64, usize)> {
    let mut ms = 0;
    let mut taken = 0;
    let mut end = start;
    while let Some(&c) = b.get(end) {
        if !c.is_ascii_digit() {
            break;
        }
        if taken < 3 {
            ms = ms * 10 + i64::from(c - b'0');
            taken += 1;
        }
        end += 1;
    }
    if end == start {
        return None;
    }
    while taken < 3 {
        ms *= 10;
        taken += 1;
    }
    Some((ms, end))
}

/// Offset from UTC in minutes for the text after the clock, `None` if it is not a zone.
fn zone(rest: &[u8], space_ok: bool, has_fraction: bool) -> Option<i64> {
    if rest.is_empty() || matches!(rest, [b'Z' | b'z']) {
        return Some(0);
    }
    // Only the space-separated form may put a single space before the sign.
    let z = if space_ok && rest.first() == Some(&b' ') {
        rest.get(1..)?
    } else {
        rest
    };
    let sign = match *z.first()? {
        b'+' => 1,
        b'-' => -1,
        _ => return None,
    };
    let body = z.get(1..)?;
    let (hh, mm) = match body.len() {
        // A bare hour after a fraction is rejected by Date.parse, unless the
        // clock is space-separated.
        2 if !has_fraction || space_ok => (digits(body, 0, 2)?, 0),
        4 => (digits(body, 0, 2)?, digits(body, 2, 2)?),
        5 if body.get(2) == Some(&b':') => (digits(body, 0, 2)?, digits(body, 3, 2)?),
        _ => return None,
    };
    if hh > 23 || mm > 59 {
        return None;
    }
    Some(sign * (hh * 60 + mm))
}

/// Days from 1970-01-01 to the civil date, Howard Hinnant's algorithm.
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let y = if month <= 2 { year - 1 } else { year };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = if month > 2 { month - 3 } else { month + 9 };
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}
