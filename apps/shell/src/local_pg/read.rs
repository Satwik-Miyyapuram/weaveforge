//! Read-only page source for the 0.9.7 export (`migrate_097_read`).
//!
//! Only the (kind, table, key) triples in `ALLOWLIST` can be read. Table and key
//! names come from the allowlist and are quoted; cursor and limit values are
//! bound parameters, never spliced into the SQL.

use std::fmt;

use serde_json::Value;

/// Largest page one call may return; a larger `limit` is clamped to this.
pub const MAX_LIMIT: u32 = 1000;

/// One exporter kind that has a local table (or view) to read.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Source {
    /// camelCase kind, as in `TABLE_BY_KIND` (apps/web/src/features/migration-097/infrastructure/postgrest-source.ts:6-27).
    pub kind: &'static str,
    /// Local relation name (the local schema replays db/migrations).
    pub table: &'static str,
    /// Unique ascending paging key. Rows are read in this order.
    pub key: &'static [&'static str],
}

/// Every kind that has a local relation. Each entry cites its create statement.
pub const ALLOWLIST: &[Source] = &[
    // db/migrations/0027_vault_pages.sql:5
    Source { kind: "notes", table: "vault_pages", key: &["id"] },
    // db/migrations/0001_papers.sql:7
    Source { kind: "papers", table: "papers", key: &["id"] },
    // db/migrations/0020_tags_normalized.sql:4
    Source { kind: "tags", table: "tags", key: &["id"] },
    // db/migrations/0104_paper_fields.sql:4
    Source { kind: "paperFields", table: "paper_field_defs", key: &["id"] },
    // db/migrations/0104_paper_fields.sql:19
    Source { kind: "paperFieldValues", table: "paper_field_values", key: &["id"] },
    // db/migrations/0005_paper_relations.sql:7
    Source { kind: "relations", table: "paper_relations", key: &["id"] },
    // db/migrations/0004_reading_lists.sql:8
    Source { kind: "readingLists", table: "reading_lists", key: &["id"] },
    // db/migrations/0120_screening_decisions.sql:13
    Source { kind: "screening", table: "screening_decisions", key: &["id"] },
    // db/migrations/0002_log_entries.sql:7
    Source { kind: "logEntries", table: "log_entries", key: &["id"] },
    // db/migrations/0011_milestones.sql:8
    Source { kind: "milestones", table: "milestones", key: &["id"] },
    // db/migrations/0009_experiments.sql:6
    Source { kind: "experiments", table: "experiments", key: &["id"] },
    // View, not a table: db/migrations/0115_experiment_metric_chunks.sql:100.
    // It has no pk; (experiment_id, metric, step) is its DISTINCT ON key, so it is unique.
    Source { kind: "metrics", table: "experiment_metrics", key: &["experiment_id", "metric", "step"] },
    // db/migrations/0003_report_sections.sql:7
    Source { kind: "reportSections", table: "report_sections", key: &["id"] },
    // db/migrations/0110_reader_annotations.sql:12
    Source { kind: "annotations", table: "reader_annotations", key: &["id"] },
    // db/migrations/0103_annotation_pins.sql:3
    Source { kind: "annotationPins", table: "annotation_pins", key: &["id"] },
    // db/migrations/0029_library_pins.sql:4
    Source { kind: "libraryPins", table: "library_pins", key: &["id"] },
    // db/migrations/0018_sharing.sql:36
    Source { kind: "comments", table: "comments", key: &["id"] },
    // db/migrations/0006_user_settings.sql:8 (pk is user_id, not id)
    Source { kind: "settings", table: "user_settings", key: &["user_id"] },
    // db/migrations/0070_ai_proposals_and_audit.sql:4
    Source { kind: "aiProposals", table: "ai_proposals", key: &["id"] },
    // db/migrations/0023_blob_registry.sql:4
    Source { kind: "blobs", table: "blob_objects", key: &["id"] },
];

/// Look up the local relation for an exporter kind. `None` means no local table
/// (for example `ink`, which is file-only).
pub fn source_for(kind: &str) -> Option<&'static Source> {
    ALLOWLIST.iter().find(|s| s.kind == kind)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReadError {
    UnknownKind(String),
    BadLimit,
    BadCursor { expected: usize, got: usize },
}

impl fmt::Display for ReadError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ReadError::UnknownKind(kind) => write!(f, "unknown migration kind: {kind}"),
            ReadError::BadLimit => write!(f, "limit must be at least 1"),
            ReadError::BadCursor { expected, got } => {
                write!(f, "cursor has {got} values, key needs {expected}")
            }
        }
    }
}

/// A page query: SQL with `$n` placeholders and the values to bind to them.
#[derive(Debug, Clone, PartialEq)]
pub struct PageQuery {
    pub sql: String,
    pub params: Vec<Value>,
}

/// Build the keyset-paging query for one page of `kind`.
///
/// `after` is the key of the last row already read (one value per key column),
/// or `None` for the first page. `limit` is clamped to `MAX_LIMIT`.
pub fn page_sql(kind: &str, after: Option<&[Value]>, limit: u32) -> Result<PageQuery, ReadError> {
    let source = source_for(kind).ok_or_else(|| ReadError::UnknownKind(kind.to_string()))?;
    if limit == 0 {
        return Err(ReadError::BadLimit);
    }
    let limit = limit.min(MAX_LIMIT);
    let columns = source.key.iter().map(|c| quote(c)).collect::<Vec<_>>().join(", ");

    let mut sql = format!("select * from {} ", quote(source.table));
    let mut params = Vec::new();
    if let Some(cursor) = after {
        if cursor.len() != source.key.len() {
            return Err(ReadError::BadCursor { expected: source.key.len(), got: cursor.len() });
        }
        let placeholders = (1..=cursor.len()).map(|i| format!("${i}")).collect::<Vec<_>>().join(", ");
        sql.push_str(&format!("where ({columns}) > ({placeholders}) "));
        params.extend(cursor.iter().cloned());
    }
    params.push(Value::from(limit));
    sql.push_str(&format!("order by {columns} limit ${}", params.len()));
    Ok(PageQuery { sql, params })
}

/// Quote an identifier. Only allowlisted names reach this, so no escaping is needed beyond the quotes.
fn quote(ident: &str) -> String {
    format!("\"{ident}\"")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// Exporter kinds from TABLE_BY_KIND (postgrest-source.ts:6-27), plus `ink` (file-only, postgrest-source.ts:30).
    const EXPORTER_KINDS: &[&str] = &[
        "notes", "papers", "tags", "paperFields", "paperFieldValues", "relations", "readingLists",
        "screening", "logEntries", "milestones", "experiments", "metrics", "reportSections",
        "annotations", "annotationPins", "libraryPins", "comments", "settings", "aiProposals",
        "blobs",
    ];

    #[test]
    fn every_exporter_kind_has_an_entry_except_ink() {
        for kind in EXPORTER_KINDS {
            assert!(source_for(kind).is_some(), "missing allowlist entry for {kind}");
        }
    }

    #[test]
    fn ink_is_file_only_and_has_no_table() {
        assert!(source_for("ink").is_none());
    }

    #[test]
    fn every_allowlist_entry_is_an_exporter_kind() {
        for s in ALLOWLIST {
            assert!(EXPORTER_KINDS.contains(&s.kind), "{} is not an exporter kind", s.kind);
        }
    }

    #[test]
    fn tables_and_keys_are_well_formed() {
        let mut tables: Vec<&str> = ALLOWLIST.iter().map(|s| s.table).collect();
        tables.sort();
        tables.dedup();
        assert_eq!(tables.len(), ALLOWLIST.len(), "duplicate table in allowlist");
        for s in ALLOWLIST {
            assert!(!s.key.is_empty(), "{} has no key", s.kind);
            assert!(s.table.bytes().all(|b| b.is_ascii_lowercase() || b == b'_'));
        }
    }

    #[test]
    fn unknown_kind_is_refused() {
        assert_eq!(
            page_sql("nope", None, 10),
            Err(ReadError::UnknownKind("nope".into()))
        );
        assert_eq!(
            page_sql("ink", None, 10),
            Err(ReadError::UnknownKind("ink".into()))
        );
    }

    #[test]
    fn zero_limit_is_refused_and_large_limit_is_capped() {
        assert_eq!(page_sql("papers", None, 0), Err(ReadError::BadLimit));
        let q = page_sql("papers", None, 5000).unwrap();
        assert_eq!(q.params, vec![json!(MAX_LIMIT)]);
    }

    #[test]
    fn first_page_has_no_where_and_orders_by_key() {
        let q = page_sql("papers", None, 50).unwrap();
        assert_eq!(q.sql, "select * from \"papers\" order by \"id\" limit $1");
        assert_eq!(q.params, vec![json!(50)]);
    }

    #[test]
    fn later_page_binds_cursor_and_never_splices_values() {
        let cursor = [json!("abc'; drop table papers; --")];
        let q = page_sql("papers", Some(&cursor), 50).unwrap();
        assert_eq!(
            q.sql,
            "select * from \"papers\" where (\"id\") > ($1) order by \"id\" limit $2"
        );
        assert_eq!(q.params, vec![json!("abc'; drop table papers; --"), json!(50)]);
        assert!(!q.sql.contains("drop"));
    }

    #[test]
    fn composite_key_for_metrics_view_pages_on_all_three_columns() {
        let cursor = [json!("exp-1"), json!("loss"), json!(10)];
        let q = page_sql("metrics", Some(&cursor), 20).unwrap();
        assert_eq!(
            q.sql,
            "select * from \"experiment_metrics\" where (\"experiment_id\", \"metric\", \"step\") > ($1, $2, $3) order by \"experiment_id\", \"metric\", \"step\" limit $4"
        );
        assert_eq!(q.params.len(), 4);
    }

    #[test]
    fn settings_pages_on_user_id() {
        let q = page_sql("settings", None, 1).unwrap();
        assert_eq!(q.sql, "select * from \"user_settings\" order by \"user_id\" limit $1");
    }

    #[test]
    fn cursor_length_must_match_key() {
        let cursor = [json!(1)];
        assert_eq!(
            page_sql("metrics", Some(&cursor), 5),
            Err(ReadError::BadCursor { expected: 3, got: 1 })
        );
    }
}
