//! Log-entry row mapping (TS `log-entry-rows.ts`). A row is the `log_entries` table's columns as
//! the database names them. Both backend providers read and write the same table, so the
//! mapping lives here once.

use serde::{Deserialize, Serialize};

use super::log_entry::{LogEntry, LogKind, LogLink};

/// A `log_entries` row as read. `links` is null on a row written without any.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[allow(missing_docs)]
pub struct LogEntryRow {
    pub id: String,
    pub entry_date: String,
    pub kind: LogKind,
    pub body: String,
    pub links: Option<Vec<LogLink>>,
    pub created_at: String,
}

/// The row a log entry is written as.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[allow(missing_docs)]
pub struct LogEntryWriteRow {
    pub id: String,
    pub entry_date: String,
    pub kind: LogKind,
    pub body: String,
    pub links: Vec<LogLink>,
    pub created_at: String,
}

/// The domain entry for a stored row (`logEntryToDomain`). Null links become an empty list.
#[must_use]
pub fn to_domain(row: &LogEntryRow) -> LogEntry {
    LogEntry {
        id: row.id.clone(),
        entry_date: row.entry_date.clone(),
        kind: row.kind,
        body: row.body.clone(),
        links: row.links.clone().unwrap_or_default(),
        created_at: row.created_at.clone(),
    }
}

/// The row a domain entry is written as (`logEntryToRow`).
#[must_use]
pub fn to_row(entry: &LogEntry) -> LogEntryWriteRow {
    LogEntryWriteRow {
        id: entry.id.clone(),
        entry_date: entry.entry_date.clone(),
        kind: entry.kind,
        body: entry.body.clone(),
        links: entry.links.clone(),
        created_at: entry.created_at.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn null_links_map_to_empty_list() {
        let row = LogEntryRow {
            id: "e1".into(),
            entry_date: "2026-03-01".into(),
            kind: LogKind::Daily,
            body: "Did things".into(),
            links: None,
            created_at: "2026-03-01T09:00:00Z".into(),
        };
        let entry = to_domain(&row);
        assert!(entry.links.is_empty());
        assert_eq!(entry.kind, LogKind::Daily);
    }

    #[test]
    fn written_link_uses_type_key() {
        let entry = LogEntry {
            id: "e1".into(),
            entry_date: "2026-03-01".into(),
            kind: LogKind::Weekly,
            body: String::new(),
            links: vec![LogLink {
                link_type: "paper".into(),
                id: "p1".into(),
            }],
            created_at: "2026-03-01T09:00:00Z".into(),
        };
        let json = serde_json::to_value(to_row(&entry)).unwrap();
        assert_eq!(json["links"][0]["type"], "paper");
        assert_eq!(json["kind"], "weekly");
    }
}
