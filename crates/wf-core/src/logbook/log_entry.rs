//! Port of the log entry construction in packages/core/src/features/logbook/domain/log-entry.ts. Pure.
//!
//! The TS `Clock` and `IdGenerator` are replaced by the caller passing the new id and the
//! current ISO 8601 time, so this module stays free of I/O.

use crate::reader_analysis::lines::js_trim;

use std::fmt;

/// Kind of log entry (TS `LogKind`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub enum LogKind {
    /// One entry per day.
    Daily,
    /// One entry per week.
    Weekly,
}

/// Every log kind (TS `LOG_KINDS`).
pub const LOG_KINDS: &[LogKind] = &[LogKind::Daily, LogKind::Weekly];

/// A reference from a log entry to another entity (TS `LogLink`).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct LogLink {
    /// Kind of entity referenced (experiment, paper, section).
    #[serde(rename = "type")]
    pub link_type: String,
    /// Id of the referenced entity.
    pub id: String,
}

/// A stored log entry (TS `LogEntry`).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct LogEntry {
    /// Entry id.
    pub id: String,
    /// Calendar date (yyyy-mm-dd) the entry is about.
    pub entry_date: String,
    /// Daily or weekly.
    pub kind: LogKind,
    /// Markdown body, trimmed.
    pub body: String,
    /// References to experiments / papers / sections.
    pub links: Vec<LogLink>,
    /// Creation time, ISO 8601 UTC.
    pub created_at: String,
}

/// Fields accepted when creating a log entry; the rest are defaulted (TS `NewLogEntryInput`).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct NewLogEntryInput {
    /// Markdown body; blank after trimming is rejected. Missing reads as blank.
    #[serde(default, deserialize_with = "crate::serde_util::null_default")]
    #[cfg_attr(feature = "specta", specta(type = String))]
    pub body: String,
    /// Calendar date; defaults to the date of `now`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub entry_date: Option<String>,
    /// Defaults to `daily`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub kind: Option<LogKind>,
    /// Defaults to no links.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub links: Option<Vec<LogLink>>,
}

/// The body was blank after trimming (TS `LogEntryValidationError`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LogEntryValidationError;

impl fmt::Display for LogEntryValidationError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Log entry body is required.")
    }
}

impl std::error::Error for LogEntryValidationError {}

/// Check the input before the clock and id generator run (TS checks the body first).
///
/// # Errors
///
/// Returns [`LogEntryValidationError`] when the body is empty after JS-style trimming.
pub fn validate_new_log_entry(input: &NewLogEntryInput) -> Result<(), LogEntryValidationError> {
    if js_trim(&input.body).is_empty() {
        return Err(LogEntryValidationError);
    }
    Ok(())
}

/// Build a valid log entry from partial input, applying defaults and invariants (TS `createLogEntry`).
///
/// `id` and `now` (ISO 8601 UTC) replace the TS `IdGenerator` and `Clock`.
///
/// # Errors
///
/// Returns [`LogEntryValidationError`] when the body is empty after trimming.
pub fn create_log_entry(
    input: NewLogEntryInput,
    id: &str,
    now: &str,
) -> Result<LogEntry, LogEntryValidationError> {
    validate_new_log_entry(&input)?;
    let body = js_trim(&input.body);
    Ok(LogEntry {
        id: id.to_owned(),
        entry_date: input.entry_date.unwrap_or_else(|| iso_date(now)),
        kind: input.kind.unwrap_or(LogKind::Daily),
        body: body.to_owned(),
        links: input.links.unwrap_or_default(),
        created_at: now.to_owned(),
    })
}

/// `isoDate`: the first ten UTF-16 units of an ISO timestamp (`iso.slice(0, 10)`).
fn iso_date(iso: &str) -> String {
    let units: Vec<u16> = iso.encode_utf16().take(10).collect();
    String::from_utf16_lossy(&units)
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: &str = "2024-03-15T10:20:30.000Z";

    fn input(body: &str) -> NewLogEntryInput {
        NewLogEntryInput {
            body: body.to_owned(),
            entry_date: None,
            kind: None,
            links: None,
        }
    }

    #[test]
    fn blank_body_is_rejected() {
        assert_eq!(
            create_log_entry(input(""), "id", NOW),
            Err(LogEntryValidationError)
        );
        assert!(create_log_entry(input(" \t\n "), "id", NOW).is_err());
    }

    #[test]
    fn defaults_come_from_now() {
        let entry = create_log_entry(input("  hello  "), "id-1", NOW).expect("valid body");
        assert_eq!(entry.id, "id-1");
        assert_eq!(entry.entry_date, "2024-03-15");
        assert_eq!(entry.kind, LogKind::Daily);
        assert_eq!(entry.body, "hello");
        assert!(entry.links.is_empty());
        assert_eq!(entry.created_at, NOW);
    }

    #[test]
    fn given_fields_are_kept() {
        let link = LogLink {
            link_type: "experiment".to_owned(),
            id: "e1".to_owned(),
        };
        let entry = create_log_entry(
            NewLogEntryInput {
                body: "x".to_owned(),
                entry_date: Some("2024-01-01".to_owned()),
                kind: Some(LogKind::Weekly),
                links: Some(vec![link.clone()]),
            },
            "id",
            NOW,
        )
        .expect("valid body");
        assert_eq!(entry.entry_date, "2024-01-01");
        assert_eq!(entry.kind, LogKind::Weekly);
        assert_eq!(entry.links, vec![link]);
    }

    #[test]
    fn empty_entry_date_is_not_defaulted() {
        // TS `??` only replaces null and undefined, so "" is kept.
        let entry = create_log_entry(
            NewLogEntryInput {
                entry_date: Some(String::new()),
                ..input("x")
            },
            "id",
            NOW,
        )
        .expect("valid body");
        assert_eq!(entry.entry_date, "");
    }

    #[test]
    fn iso_date_counts_utf16_units() {
        assert_eq!(iso_date("2024-03-15T10:20:30Z"), "2024-03-15");
        assert_eq!(iso_date("2024"), "2024");
    }
}
