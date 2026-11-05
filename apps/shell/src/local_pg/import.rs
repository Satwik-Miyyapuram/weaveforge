//! One-time copy of an old PGlite database (read through the Node sidecar) into the native Postgres.
//!
//! Runs after the new database has its migrations. Every insert uses `on conflict do nothing`, so
//! rows the new database already has are kept.

use serde_json::Value;

use super::{Conn, PgError, TextRows};

/// The old database, read-only: runs one SQL statement and returns its rows as JSON objects.
pub trait SourceDb: Send {
    /// Runs `sql` with no params.
    fn rows(
        &mut self,
        sql: &str,
    ) -> impl std::future::Future<Output = Result<Vec<Value>, PgError>> + Send;
}

/// Tables to copy: schema and name of each plain or partitioned table in the app schemas.
pub const TABLES_SQL: &str = "select n.nspname as schema, c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relkind in ('r','p') and not c.relispartition and n.nspname in ('public','auth','storage') order by n.nspname, c.relname";

/// Serial and identity columns in the app schemas: schema, table, column, sequence.
pub const SEQUENCES_SQL: &str = "select n.nspname as schema, c.relname as name, a.attname as col, pg_get_serial_sequence(format('%I.%I', n.nspname, c.relname), a.attname) as seq from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace where c.relkind in ('r','p') and n.nspname in ('public','auth','storage') and a.attnum > 0 and not a.attisdropped and pg_get_serial_sequence(format('%I.%I', n.nspname, c.relname), a.attname) is not null";

/// Column facts from `pg_attribute`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ColumnInfo {
    /// The column name.
    pub name: String,
    /// `attidentity`: `a` for always, `d` for by default, empty for none.
    pub identity: String,
    /// `attgenerated`: empty for a normal column, non-empty for a generated one.
    pub generated: String,
}

/// What `import` copied and skipped.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct ImportReport {
    /// Qualified table name and rows copied, in copy order.
    pub tables: Vec<(String, u64)>,
    /// Source tables that the target does not have, qualified.
    pub skipped: Vec<String>,
}

/// Quotes an identifier with double quotes, doubling any inner double quote.
#[must_use]
pub fn quote_ident(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

/// A schema-qualified, quoted table name such as `"public"."papers"`.
#[must_use]
pub fn qualified(schema: &str, table: &str) -> String {
    format!("{}.{}", quote_ident(schema), quote_ident(table))
}

/// Lists a table's columns with their identity and generated flags, in column order.
#[must_use]
pub fn columns_sql(schema: &str, table: &str) -> String {
    format!(
        "select a.attname as name, a.attidentity as identity, a.attgenerated as generated from pg_attribute a where a.attrelid = '{}'::regclass and a.attnum > 0 and not a.attisdropped order by a.attnum",
        escape_literal(&qualified(schema, table))
    )
}

/// Reads one page of a table as one JSON text per row, in `ctid` order.
#[must_use]
pub fn page_sql(schema: &str, table: &str, limit: u64, offset: u64) -> String {
    format!(
        "select row_to_json(t)::text as j from {} t order by t.ctid limit {limit} offset {offset}",
        qualified(schema, table)
    )
}

/// Inserts JSON rows into a table's listed columns, skipping rows that already exist.
#[must_use]
pub fn insert_sql(schema: &str, table: &str, columns: &[String], identity_always: bool) -> String {
    let q = qualified(schema, table);
    let cols = columns
        .iter()
        .map(String::as_str)
        .map(quote_ident)
        .collect::<Vec<_>>()
        .join(", ");
    let overriding = if identity_always {
        "overriding system value "
    } else {
        ""
    };
    format!(
        "insert into {q} ({cols}) {overriding}select {cols} from json_populate_recordset(null::{q}, $1::json) on conflict do nothing"
    )
}

/// Moves a sequence to just past the largest value in its column.
#[must_use]
pub fn setval_sql(seq: &str, schema: &str, table: &str, column: &str) -> String {
    format!(
        "select setval('{}', coalesce((select max({}) from {}), 0) + 1, false)",
        escape_literal(seq),
        quote_ident(column),
        qualified(schema, table)
    )
}

/// Columns to copy: target columns that are not generated and exist in the source, in target order.
/// The bool is true when a chosen column is `generated always as identity`.
#[must_use]
pub fn copy_columns(target: &[ColumnInfo], source: &[ColumnInfo]) -> (Vec<String>, bool) {
    let chosen: Vec<&ColumnInfo> = target
        .iter()
        .filter(|c| c.generated.is_empty() && source.iter().any(|s| s.name == c.name))
        .collect();
    let identity = chosen.iter().any(|c| c.identity == "a");
    (chosen.iter().map(|c| c.name.clone()).collect(), identity)
}

/// Copies every row of the old database into the target, in one transaction.
///
/// Tables missing from the target are skipped and reported. Sequences are moved past the copied
/// data at the end.
pub async fn import<S: SourceDb, C: Conn>(
    source: &mut S,
    target: &mut C,
    page_rows: u64,
) -> Result<ImportReport, PgError> {
    let source_tables: Vec<(String, String)> = source
        .rows(TABLES_SQL)
        .await?
        .iter()
        .map(|r| (text_field(r, "schema"), text_field(r, "name")))
        .collect();
    let target_tables: Vec<(String, String)> = target
        .query(TABLES_SQL, &[])
        .await?
        .rows
        .iter()
        .map(|r| (cell(r, 0), cell(r, 1)))
        .collect();
    let mut report = ImportReport::default();
    target.exec("BEGIN").await?;
    let outcome = match copy_all(
        source,
        target,
        &source_tables,
        &target_tables,
        page_rows,
        &mut report,
    )
    .await
    {
        Ok(()) => target.exec("COMMIT").await,
        Err(e) => Err(e),
    };
    match outcome {
        Ok(()) => Ok(report),
        Err(e) => {
            let _ = target.exec("ROLLBACK").await;
            Err(e)
        }
    }
}

/// Copies all tables and resets sequences, inside the caller's transaction.
async fn copy_all<S: SourceDb, C: Conn>(
    source: &mut S,
    target: &mut C,
    source_tables: &[(String, String)],
    target_tables: &[(String, String)],
    page_rows: u64,
    report: &mut ImportReport,
) -> Result<(), PgError> {
    target
        .exec("set local session_replication_role = replica")
        .await?;
    for (schema, table) in source_tables {
        let name = qualified(schema, table);
        if !target_tables.iter().any(|(s, t)| s == schema && t == table) {
            report.skipped.push(name);
            continue;
        }
        let copied = copy_table(source, target, schema, table, page_rows)
            .await
            .map_err(|e| prefix(&name, e))?;
        report.tables.push((name, copied));
    }
    reset_sequences(target).await
}

/// Copies one table's shared columns, a page at a time. Returns the rows copied.
async fn copy_table<S: SourceDb, C: Conn>(
    source: &mut S,
    target: &mut C,
    schema: &str,
    table: &str,
    page_rows: u64,
) -> Result<u64, PgError> {
    let src_cols = source_columns(&source.rows(&columns_sql(schema, table)).await?);
    let tgt_cols = target_columns(&target.query(&columns_sql(schema, table), &[]).await?);
    let (cols, identity) = copy_columns(&tgt_cols, &src_cols);
    if cols.is_empty() {
        return Ok(0);
    }
    let sql = insert_sql(schema, table, &cols, identity);
    let mut copied: u64 = 0;
    let mut offset: u64 = 0;
    loop {
        let page = source
            .rows(&page_sql(schema, table, page_rows, offset))
            .await?;
        if page.is_empty() {
            break;
        }
        let n = u64::try_from(page.len()).map_err(|e| PgError::local(e.to_string()))?;
        let array = page_array(&page)?;
        let _ = target.query(&sql, &[Value::String(array)]).await?;
        copied += n;
        if n < page_rows {
            break;
        }
        offset += page_rows;
    }
    Ok(copied)
}

/// Moves each serial or identity sequence past its column's largest value.
async fn reset_sequences<C: Conn>(target: &mut C) -> Result<(), PgError> {
    let seqs = target.query(SEQUENCES_SQL, &[]).await?;
    for row in &seqs.rows {
        let sql = setval_sql(&cell(row, 3), &cell(row, 0), &cell(row, 1), &cell(row, 2));
        let _ = target.query(&sql, &[]).await?;
    }
    Ok(())
}

/// Joins page rows (each `{"j": ...}`) into one JSON array text.
fn page_array(rows: &[Value]) -> Result<String, PgError> {
    let mut out = String::from("[");
    for (i, row) in rows.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        let piece = match row.get("j") {
            Some(Value::String(s)) => s.clone(),
            Some(other) => {
                serde_json::to_string(other).map_err(|e| PgError::local(e.to_string()))?
            }
            None => return Err(PgError::local("source row has no j field")),
        };
        out.push_str(&piece);
    }
    out.push(']');
    Ok(out)
}

/// Source column facts from the JSON rows of `columns_sql`; missing or null fields are empty.
fn source_columns(rows: &[Value]) -> Vec<ColumnInfo> {
    rows.iter()
        .map(|r| ColumnInfo {
            name: text_field(r, "name"),
            identity: text_field(r, "identity"),
            generated: text_field(r, "generated"),
        })
        .collect()
}

/// Target column facts from the text rows of `columns_sql`; null cells are empty.
fn target_columns(rows: &TextRows) -> Vec<ColumnInfo> {
    rows.rows
        .iter()
        .map(|r| ColumnInfo {
            name: cell(r, 0),
            identity: cell(r, 1),
            generated: cell(r, 2),
        })
        .collect()
}

/// A string field of a JSON object; missing or null is empty.
fn text_field(v: &Value, key: &str) -> String {
    v.get(key).and_then(Value::as_str).unwrap_or("").to_owned()
}

/// A text cell by index; null or missing is empty.
fn cell(row: &[Option<String>], i: usize) -> String {
    row.get(i).cloned().flatten().unwrap_or_default()
}

/// Doubles single quotes for use inside a SQL string literal.
fn escape_literal(s: &str) -> String {
    s.replace('\'', "''")
}

/// Adds the table name to an error from copying that table.
fn prefix(table: &str, e: PgError) -> PgError {
    PgError {
        message: format!("Import of {table} failed: {}", e.message),
        ..e
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A row of text cells.
    fn row(cells: &[&str]) -> Vec<Option<String>> {
        cells.iter().map(|c| Some((*c).to_owned())).collect()
    }

    /// A column fact for the pure-function tests.
    fn ci(name: &str, identity: &str, generated: &str) -> ColumnInfo {
        ColumnInfo {
            name: name.to_owned(),
            identity: identity.to_owned(),
            generated: generated.to_owned(),
        }
    }

    /// Source with `public.papers` (2 rows, plus `extra` column) and `public.old_only` (not in target).
    #[derive(Default)]
    struct FakeSource {
        calls: Vec<String>,
        tables: Vec<Value>,
        columns: Vec<Value>,
        papers: Vec<String>,
    }

    impl FakeSource {
        /// Rows of a `page_sql` query, by its limit and offset.
        fn page(&self, sql: &str) -> Vec<Value> {
            let offset = sql
                .rsplit(' ')
                .next()
                .and_then(|t| t.parse::<usize>().ok())
                .unwrap_or(0);
            let limit = sql
                .split(" limit ")
                .nth(1)
                .and_then(|s| s.split(' ').next())
                .and_then(|t| t.parse::<usize>().ok())
                .unwrap_or(0);
            self.papers
                .iter()
                .skip(offset)
                .take(limit)
                .map(|t| serde_json::json!({ "j": t }))
                .collect()
        }
    }

    impl SourceDb for FakeSource {
        async fn rows(&mut self, sql: &str) -> Result<Vec<Value>, PgError> {
            self.calls.push(sql.to_owned());
            if sql == TABLES_SQL {
                return Ok(self.tables.clone());
            }
            if sql == columns_sql("public", "papers") {
                return Ok(self.columns.clone());
            }
            if sql.starts_with("select row_to_json") {
                return Ok(self.page(sql));
            }
            Err(PgError::local(format!("unexpected source sql: {sql}")))
        }
    }

    /// Target with `public.papers` (id, title, generated body_preview). Logs every statement.
    #[derive(Default)]
    struct FakeTarget {
        log: Vec<String>,
        inserted: Vec<String>,
        fail_insert: bool,
    }

    impl Conn for FakeTarget {
        async fn exec(&mut self, sql: &str) -> Result<(), PgError> {
            self.log.push(sql.to_owned());
            Ok(())
        }

        async fn query(&mut self, sql: &str, params: &[Value]) -> Result<TextRows, PgError> {
            self.log.push(sql.to_owned());
            if sql.starts_with("insert into") {
                if self.fail_insert {
                    return Err(PgError {
                        code: "23505".to_owned(),
                        message: "boom".to_owned(),
                    });
                }
                if let Some(Value::String(s)) = params.first() {
                    self.inserted.push(s.clone());
                }
                return Ok(TextRows::default());
            }
            let rows = if sql == TABLES_SQL {
                vec![row(&["public", "papers"])]
            } else if sql == columns_sql("public", "papers") {
                vec![
                    row(&["id", "", ""]),
                    row(&["title", "", ""]),
                    row(&["body_preview", "", "s"]),
                ]
            } else {
                Vec::new()
            };
            Ok(TextRows {
                rows,
                ..Default::default()
            })
        }
    }

    /// A source holding the two papers rows and the source-only table.
    fn papers_source() -> FakeSource {
        FakeSource {
            calls: Vec::new(),
            tables: vec![
                serde_json::json!({"schema": "public", "name": "papers"}),
                serde_json::json!({"schema": "public", "name": "old_only"}),
            ],
            columns: vec![
                serde_json::json!({"name": "id", "identity": "", "generated": ""}),
                serde_json::json!({"name": "title", "identity": "", "generated": ""}),
                serde_json::json!({"name": "extra", "identity": "", "generated": ""}),
            ],
            papers: vec![
                r#"{"id":1,"title":"a","extra":"x"}"#.to_owned(),
                r#"{"id":2,"title":"b","extra":"y"}"#.to_owned(),
            ],
        }
    }

    #[test]
    fn quote_ident_doubles_quotes() {
        assert_eq!(quote_ident("a\"b"), "\"a\"\"b\"");
        assert_eq!(qualified("public", "papers"), "\"public\".\"papers\"");
    }

    #[test]
    fn columns_sql_escapes_single_quote() {
        let sql = columns_sql("public", "o'x");
        assert!(sql.contains("'\"public\".\"o''x\"'::regclass"));
    }

    #[test]
    fn insert_sql_overrides_identity_only_when_asked() {
        let cols = vec!["id".to_owned()];
        let always = insert_sql("public", "crdt_updates", &cols, true);
        let over = always.find("overriding system value");
        let select = always.find("select");
        assert!(over.is_some() && over < select);
        assert!(always.ends_with("on conflict do nothing"));

        let plain = insert_sql("public", "papers", &cols, false);
        assert!(!plain.contains("overriding"));
        assert!(plain.ends_with("on conflict do nothing"));
    }

    #[test]
    fn copy_columns_keeps_target_order_and_identity() {
        let target = vec![
            ci("id", "a", ""),
            ci("body_preview", "", "s"),
            ci("title", "", ""),
            ci("target_only", "", ""),
        ];
        let source = vec![ci("title", "", ""), ci("id", "", ""), ci("extra", "", "")];
        let (cols, identity) = copy_columns(&target, &source);
        assert_eq!(cols, vec!["id".to_owned(), "title".to_owned()]);
        assert!(identity);
    }

    #[test]
    fn setval_sql_text() {
        assert_eq!(
            setval_sql("public.papers_id_seq", "public", "papers", "id"),
            "select setval('public.papers_id_seq', coalesce((select max(\"id\") from \"public\".\"papers\"), 0) + 1, false)"
        );
    }

    #[tokio::test]
    async fn import_copies_shared_columns_and_skips_source_only() -> Result<(), PgError> {
        let mut source = papers_source();
        let mut target = FakeTarget::default();
        let report = import(&mut source, &mut target, 1).await?;
        assert_eq!(
            report,
            ImportReport {
                tables: vec![(qualified("public", "papers"), 2)],
                skipped: vec![qualified("public", "old_only")],
            }
        );
        let pages = source
            .calls
            .iter()
            .filter(|c| c.starts_with("select row_to_json"))
            .count();
        assert_eq!(pages, 3);
        // The target's table list is read before the transaction opens.
        assert_eq!(target.log.first().map(String::as_str), Some(TABLES_SQL));
        assert_eq!(target.log.get(1).map(String::as_str), Some("BEGIN"));
        assert_eq!(
            target.log.get(2).map(String::as_str),
            Some("set local session_replication_role = replica")
        );
        assert_eq!(target.log.last().map(String::as_str), Some("COMMIT"));
        let cols = vec!["id".to_owned(), "title".to_owned()];
        assert!(
            target
                .log
                .contains(&insert_sql("public", "papers", &cols, false))
        );
        assert_eq!(
            target.inserted,
            vec![
                format!("[{}]", r#"{"id":1,"title":"a","extra":"x"}"#),
                format!("[{}]", r#"{"id":2,"title":"b","extra":"y"}"#),
            ]
        );
        Ok(())
    }

    #[tokio::test]
    async fn import_insert_error_rolls_back() -> Result<(), PgError> {
        let mut source = papers_source();
        let mut target = FakeTarget {
            fail_insert: true,
            ..Default::default()
        };
        let Err(err) = import(&mut source, &mut target, 1).await else {
            return Err(PgError::local("expected import to fail"));
        };
        assert!(
            err.message
                .starts_with("Import of \"public\".\"papers\" failed")
        );
        assert_eq!(target.log.last().map(String::as_str), Some("ROLLBACK"));
        Ok(())
    }
}
