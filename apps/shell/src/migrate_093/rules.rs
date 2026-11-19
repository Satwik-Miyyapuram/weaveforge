//! Pure rules for the 0.9.2 to files migration: which copy wins, what is kept beside it,
//! which trashed paths stay gone, and how legacy shares become grant rows.
//! Files are named by path only; no id-keyed names or pairing.

use wf_core::sync::folder_layout::TRASH_DIR;

/// Suffix for the older copy kept beside a file the migration replaced.
const MIGRATED_SUFFIX: &str = ".migrated-0.9.4";

/// A file's current text in the workspace, and when it was last changed (ISO-8601 UTC, ms).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Stored {
    /// Last change time of the stored copy.
    pub updated_at: String,
    /// The stored text.
    pub text: String,
}

/// What the migration does with one row.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Decision {
    /// No file yet: write the row.
    Create,
    /// The path sits in the trash: never revive it.
    SkipTrashed,
    /// The file already has the row's text: nothing to do.
    Same,
    /// The row is newer: write it, keeping the replaced text at `copy_to`.
    Replace {
        /// The text the file had before the write.
        previous: String,
        /// Where the replaced text is kept.
        copy_to: String,
    },
    /// The file wins: keep it, and write the row's text at `conflict_path`.
    KeepFile {
        /// Where the row's text is kept.
        conflict_path: String,
    },
}

/// Kind suffixes that stay last in a copy's name, so the copy keeps its kind.
const KIND_TAILS: [&str; 4] = [".paper", ".ink", ".annotations", ".comments"];

/// `dir/Title.paper.md` -> `dir/Title.migrated-0.9.4.paper.md`; a name with no kind suffix gets
/// the marker before its extension.
#[must_use]
pub fn migrated_copy_path(rel: &str) -> String {
    let (stem, ext) = split_extension(rel);
    match KIND_TAILS.iter().find(|tail| stem.ends_with(*tail)) {
        Some(tail) => {
            let base = &stem[..stem.len() - tail.len()];
            format!("{base}{MIGRATED_SUFFIX}{tail}{ext}")
        }
        None => format!("{stem}{MIGRATED_SUFFIX}{ext}"),
    }
}

/// Splits off the extension of the file name (the last dot after the last `/`).
fn split_extension(rel: &str) -> (&str, &str) {
    let name_start = rel.rfind('/').map_or(0, |i| i + 1);
    match rel[name_start..].rfind('.') {
        Some(dot) if dot > 0 => rel.split_at(name_start + dot),
        _ => (rel, ""),
    }
}

/// Whether `rel` is in the trash: `.weaveforge/trash/<date>/<rel>` is among `entries`.
#[must_use]
pub fn is_trashed(rel: &str, entries: &[String]) -> bool {
    entries.iter().any(|entry| {
        entry
            .strip_prefix(TRASH_DIR)
            .and_then(|rest| rest.strip_prefix('/'))
            .and_then(|rest| rest.split_once('/'))
            .is_some_and(|(_date, tail)| tail == rel)
    })
}

/// Decides one 0.9.2 row against the file already in the workspace.
/// A row strictly newer than the file (compared as instants) wins in the file. Anything else,
/// including a time that does not parse, keeps the file and writes the row as the migrated copy.
#[must_use]
pub fn decide(
    rel: &str,
    row_updated_at: &str,
    row_text: &str,
    existing: Option<&Stored>,
    trashed: bool,
) -> Decision {
    if trashed {
        return Decision::SkipTrashed;
    }
    let Some(existing) = existing else {
        return Decision::Create;
    };
    if existing.text == row_text {
        return Decision::Same;
    }
    match (
        parse_rfc3339(row_updated_at),
        parse_rfc3339(&existing.updated_at),
    ) {
        (Some(row), Some(file)) if row > file => Decision::Replace {
            previous: existing.text.clone(),
            copy_to: migrated_copy_path(rel),
        },
        _ => Decision::KeepFile {
            conflict_path: migrated_copy_path(rel),
        },
    }
}

/// Parses an RFC 3339 time (`YYYY-MM-DDTHH:MM:SS[.fraction]` then `Z` or `+HH:MM`/`-HH:MM`) into
/// UTC seconds and nanoseconds, so times compare as instants. Anything else gives `None`.
#[must_use]
pub fn parse_rfc3339(text: &str) -> Option<(i64, u32)> {
    let bytes = text.as_bytes();
    let separators_ok = [(4, b'-'), (7, b'-'), (13, b':'), (16, b':')]
        .iter()
        .all(|&(at, sep)| bytes.get(at) == Some(&sep));
    if !separators_ok || !matches!(bytes.get(10), Some(b'T' | b't' | b' ')) {
        return None;
    }
    let year = digits(text.get(0..4)?)?;
    let month = digits(text.get(5..7)?)?;
    let day = digits(text.get(8..10)?)?;
    let hour = digits(text.get(11..13)?)?;
    let minute = digits(text.get(14..16)?)?;
    let second = digits(text.get(17..19)?)?;
    let day_ok = (1..=days_in_month(year, month)).contains(&day);
    if !(1..=12).contains(&month) || !day_ok || hour > 23 || minute > 59 || second > 59 {
        return None;
    }
    let (nanos, zone) = split_fraction(text.get(19..)?)?;
    let offset_minutes = zone_minutes(zone)?;
    let days = days_from_civil(year, month, day);
    let seconds = days * 86_400 + hour * 3_600 + minute * 60 + second - offset_minutes * 60;
    Some((seconds, nanos))
}

/// All-ASCII-digit text as a number.
fn digits(part: &str) -> Option<i64> {
    if !part.is_empty() && part.bytes().all(|b| b.is_ascii_digit()) {
        part.parse().ok()
    } else {
        None
    }
}

/// Reads an optional `.fraction` off the front of the rest of a time, as nanoseconds.
fn split_fraction(rest: &str) -> Option<(u32, &str)> {
    let Some(frac) = rest.strip_prefix('.') else {
        return Some((0, rest));
    };
    let count = frac.bytes().take_while(u8::is_ascii_digit).count();
    if count == 0 {
        return None;
    }
    let mut nanos = String::from(&frac[..count.min(9)]);
    while nanos.len() < 9 {
        nanos.push('0');
    }
    Some((nanos.parse().ok()?, &frac[count..]))
}

/// The UTC offset in minutes of a `Z` or `+HH:MM` / `-HH:MM` zone.
fn zone_minutes(zone: &str) -> Option<i64> {
    if zone == "Z" || zone == "z" {
        return Some(0);
    }
    let sign = match zone.as_bytes().first().copied()? {
        b'+' => 1_i64,
        b'-' => -1_i64,
        _ => return None,
    };
    if zone.len() != 6 || zone.as_bytes().get(3) != Some(&b':') {
        return None;
    }
    let hours = digits(zone.get(1..3)?)?;
    let minutes = digits(zone.get(4..6)?)?;
    if hours > 23 || minutes > 59 {
        return None;
    }
    Some(sign * (hours * 60 + minutes))
}

fn days_in_month(year: i64, month: i64) -> i64 {
    let leap = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
    match month {
        2 if leap => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    }
}

/// Days since 1970-01-01 of a proleptic Gregorian date (civil-day algorithm).
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let y = if month <= 2 { year - 1 } else { year };
    let era = (if y >= 0 { y } else { y - 399 }) / 400;
    let year_of_era = y - era * 400;
    let month_index = (month + 9) % 12;
    let day_of_year = (153 * month_index + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

/// A row of the legacy `shares` table (0.9.2 database).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LegacyShare {
    /// Who shared it.
    pub owner: String,
    /// Who it was shared with.
    pub recipient: String,
    /// The legacy resource type, such as `paper` or `vault_page`.
    pub resource_type: String,
    /// The shared item; `None` for a share-all, which names no single item.
    pub resource_id: Option<String>,
    /// `view` or `comment`.
    pub access: String,
}

/// A `grants` row to insert on the server.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GrantRow {
    /// `item` for a single item.
    pub scope: String,
    /// The item the grant covers.
    pub target_id: String,
    /// The user the grant is for.
    pub grantee_user: String,
    /// `view`, `comment` or `edit`.
    pub permission: String,
    /// The user who shared.
    pub owner: String,
}

/// Turns one legacy share into a grant. A share with no single item has no grant to make.
///
/// # Errors
/// No `resource_id` (share-all), or an access level that has no grant permission.
pub fn share_to_grant(share: &LegacyShare) -> Result<GrantRow, String> {
    let target_id = share
        .resource_id
        .clone()
        .ok_or_else(|| format!("share-all of {} has no single item", share.resource_type))?;
    let permission = match share.access.as_str() {
        "view" | "comment" => share.access.clone(),
        other => return Err(format!("access {other} has no grant permission")),
    };
    Ok(GrantRow {
        scope: "item".to_owned(),
        target_id,
        grantee_user: share.recipient.clone(),
        permission,
        owner: share.owner.clone(),
    })
}

/// Where grants and shared-doc publishes go. The server sink is wired by the runner.
pub trait ShareSink {
    /// Inserts one grant row.
    ///
    /// # Errors
    /// The server refused or could not be reached.
    fn insert_grant(&mut self, grant: &GrantRow) -> Result<(), String>;

    /// Publishes the shared doc for `item_id`; only called after its grants are in.
    ///
    /// # Errors
    /// The server refused or could not be reached.
    fn publish_shared_doc(&mut self, item_id: &str) -> Result<(), String>;
}

/// What the share pass did.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ShareReport {
    /// Grants inserted.
    pub granted: usize,
    /// One line per share that could not be granted.
    pub skipped: Vec<String>,
}

/// Inserts every grant first, then publishes each granted item, so no shared doc is
/// published before its grants exist.
///
/// # Errors
/// The sink failed on an insert or publish.
pub fn run_shares<S: ShareSink>(
    sink: &mut S,
    shares: &[LegacyShare],
) -> Result<ShareReport, String> {
    let mut report = ShareReport::default();
    let mut published: Vec<String> = Vec::new();
    for share in shares {
        match share_to_grant(share) {
            Ok(grant) => {
                sink.insert_grant(&grant)?;
                report.granted += 1;
                if !published.contains(&grant.target_id) {
                    published.push(grant.target_id);
                }
            }
            Err(reason) => report.skipped.push(reason),
        }
    }
    for item_id in &published {
        sink.publish_shared_doc(item_id)?;
    }
    Ok(report)
}
