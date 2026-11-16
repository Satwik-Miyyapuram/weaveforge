//! Calendar-date text (TS `isoDate` and `localIsoDate` in `packages/core/src/shared/parts.ts`).
//! Pure: the caller reads the local fields from its own `Date`, since Rust has no time zone.

/// `isoDate`: the first ten UTF-16 units of an ISO timestamp (`iso.slice(0, 10)`).
#[must_use]
pub fn iso_date(iso: &str) -> String {
    let units: Vec<u16> = iso.encode_utf16().take(10).collect();
    String::from_utf16_lossy(&units)
}

/// `localIsoDate`: a local calendar date as `YYYY-MM-DD`. The year is written as is, the month
/// and day padded to two digits, as the TS `padStart` did. `month` is 1-based.
#[must_use]
pub fn local_iso_date(year: i32, month: u32, day: u32) -> String {
    format!("{year}-{month:02}-{day:02}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn iso_date_takes_the_calendar_part() {
        // it: isoDate
        assert_eq!(iso_date("2026-06-24T12:00:00.000Z"), "2026-06-24");
        assert_eq!(iso_date("2024"), "2024");
    }

    #[test]
    fn local_iso_date_is_the_local_calendar_date_even_near_midnight() {
        // it: localIsoDate: the local calendar date, even near midnight (35-20)
        assert_eq!(local_iso_date(2026, 1, 1), "2026-01-01");
        assert_eq!(local_iso_date(2026, 1, 2), "2026-01-02");
        assert_eq!(local_iso_date(2026, 12, 31), "2026-12-31");
        assert_eq!(local_iso_date(2026, 9, 5), "2026-09-05");
    }
}
