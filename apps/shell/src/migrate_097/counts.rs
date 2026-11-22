//! Row counts for the 0.9.7 migration (`migrate_097_counts`). `counts` holds, for every personal
//! table that exists, its rows (soft-deleted rows excluded where the table has `deleted_at`).
//! `crdtTail` holds, for each CRDT entity kind, the `crdt_updates` rows past the entity's
//! `snapshot_upto`. The TS exporter compares these numbers with the files it wrote.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::local_pg::{Conn, PgError};

/// Personal tables: the 0165 move list plus child and junction tables. A name missing from the
/// cluster is skipped, so one list works on every schema version.
pub const PERSONAL_TABLES: &[&str] = &[
    "projects",
    "papers",
    "tags",
    "paper_tags",
    "paper_field_defs",
    "paper_field_values",
    "paper_relations",
    "paper_locus_anchors",
    "annotation_pins",
    "annotation_quotation_types",
    "reader_annotations",
    "reading_lists",
    "reading_list_items",
    "library_pins",
    "citation_alert_tracks",
    "log_entries",
    "milestones",
    "experiments",
    "experiment_metric_names",
    "experiment_metric_points",
    "experiment_metrics",
    "experiment_metric_chunks",
    "report_sections",
    "vault_pages",
    "comments",
    "blob_objects",
    "user_settings",
    "ai_proposals",
];

/// CRDT entity kinds, each with the table whose `snapshot_upto` marks how far the log is folded.
pub const CRDT_KINDS: &[(&str, &str)] = &[
    ("vault_page", "vault_pages"),
    ("report_section", "report_sections"),
    ("log_entry", "log_entries"),
];

/// The reply of `migrate_097_counts`. Field names are camelCase on the wire.
#[derive(Debug, Default, Serialize, Deserialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RowCounts {
    /// Table name to row count, for each personal table present.
    pub counts: BTreeMap<String, u32>,
    /// CRDT kind to `crdt_updates` rows past `snapshot_upto`.
    pub crdt_tail: BTreeMap<String, u32>,
}

/// One statement that returns both maps as a JSON text value, so it runs the same through the
/// test `Conn` and through the app's `LocalDb::query`.
#[must_use]
pub fn counts_sql() -> String {
    let tables = PERSONAL_TABLES
        .iter()
        .map(|t| format!("('{t}')"))
        .collect::<Vec<_>>()
        .join(", ");
    let crdt = CRDT_KINDS
        .iter()
        .map(|(kind, table)| {
            format!(
                "select '{kind}' as kind, count(*) as n from crdt_updates u \
                 join {table} e on e.id = u.resource_id \
                 where u.resource_type = '{kind}' and u.id > coalesce(e.snapshot_upto, 0)"
            )
        })
        .collect::<Vec<_>>()
        .join(" union all ");
    format!(
        "select json_build_object(
  'counts', (
    select coalesce(json_object_agg(t.name, (xpath('/row/n/text()', query_to_xml(
        format('select count(*)::text as n from public.%I where %s', t.name,
          case when exists (select 1 from information_schema.columns c
                where c.table_schema = 'public' and c.table_name = t.name
                  and c.column_name = 'deleted_at')
            then 'deleted_at is null' else 'true' end),
        false, true, '')))[1]::text::bigint), '{{}}'::json)
    from (values {tables}) as t(name)
    join information_schema.tables it
      on it.table_schema = 'public' and it.table_name = t.name
  ),
  'crdtTail', (
    select coalesce(json_object_agg(k.kind, k.n), '{{}}'::json)
    from ({crdt}) k
  )
)::text"
    )
}

/// Parses the JSON text that `counts_sql` returns.
///
/// # Errors
/// A message when the text is not the expected shape.
pub fn parse_counts(json: &str) -> Result<RowCounts, String> {
    serde_json::from_str(json).map_err(|e| format!("row counts unreadable: {e}"))
}

/// Runs `counts_sql` on a connection.
///
/// # Errors
/// The statement's error, or a reply that is missing or unreadable.
pub async fn count_rows<C: Conn>(conn: &mut C) -> Result<RowCounts, PgError> {
    let rows = conn.query(&counts_sql(), &[]).await?;
    let text = rows
        .rows
        .first()
        .and_then(|row| row.first())
        .and_then(Clone::clone)
        .ok_or_else(|| PgError::local("row counts query returned no value".to_owned()))?;
    parse_counts(&text).map_err(PgError::local)
}
