//! One-time import of the old PGlite data into the native database, on the owner connection.
//!
//! Each table is one transaction. Inside it the rows go in as JSON batches of about `BATCH_BYTES`,
//! each identity and serial sequence moves past the imported keys, and a row is added to
//! `wf_import.done`. That ledger row is in the same transaction, so a table is either fully
//! imported and recorded, or not at all. A crash, a dropped connection or a failed COMMIT rolls
//! the table back, and a rerun starts it from nothing. Keyless tables depend on this.
//!
//! Keyed tables insert with `ON CONFLICT ON CONSTRAINT <primary key>`, so a native row with the
//! same key is kept and only that conflict is skipped. Any other unique violation is an error.
//! A skipped row must equal the native row it collided with; if one differs, the table fails and
//! rolls back, so old data is never dropped without a word.
//! The marker file is written last, after every table is in the ledger, and is synced to disk.

use std::collections::BTreeSet;
use std::fs::File;
use std::io::{self, Write};
use std::path::Path;

use serde_json::Value;

use super::{Conn, PgError};

/// Bytes of JSON per INSERT. A single row bigger than this is sent alone.
pub const BATCH_BYTES: usize = 8 * 1024 * 1024;

/// Creates the ledger schema and table. Idempotent, and run outside any data transaction.
pub const LEDGER_SQL: &str = "CREATE SCHEMA IF NOT EXISTS wf_import; \
    CREATE TABLE IF NOT EXISTS wf_import.done (\
    table_name text PRIMARY KEY, row_count bigint NOT NULL, \
    finished_at timestamptz NOT NULL DEFAULT now())";

const COLUMNS_SQL: &str = "SELECT a.attname, a.attidentity FROM pg_attribute a \
    WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped \
    AND a.attgenerated = '' ORDER BY a.attnum";

const PK_SQL: &str = "SELECT conname FROM pg_constraint \
    WHERE conrelid = $1::regclass AND contype = 'p'";

const PK_COLUMNS_SQL: &str = "SELECT a.attname FROM pg_constraint c \
    CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) \
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum \
    WHERE c.conrelid = $1::regclass AND c.contype = 'p' ORDER BY k.ord";

const SEQUENCES_SQL: &str = "SELECT a.attname, d.objid::regclass::text FROM pg_depend d \
    JOIN pg_class s ON s.oid = d.objid AND s.relkind = 'S' \
    JOIN pg_attribute a ON a.attrelid = d.refobjid AND a.attnum = d.refobjsubid \
    WHERE d.classid = 'pg_class'::regclass AND d.refclassid = 'pg_class'::regclass \
    AND d.refobjid = $1::regclass AND d.refobjsubid > 0 AND d.deptype IN ('a', 'i')";

/// Quotes a SQL identifier: `my "t"` becomes `"my ""t"""`.
#[must_use]
pub fn quote_ident(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

/// What the importer needs to know about a table, read from the catalog.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Shape {
    /// The columns that can be written. Stored generated columns are left out.
    pub columns: Vec<String>,
    /// True when a column is `GENERATED ALWAYS`, so the insert must say OVERRIDING SYSTEM VALUE.
    pub identity_always: bool,
    /// The primary key's constraint name, when the table has one.
    pub primary_key: Option<String>,
    /// The primary key's columns, in key order. Empty when the table has no primary key.
    pub primary_key_columns: Vec<String>,
    /// Each serial or identity column, with its sequence as `regclass` text.
    pub sequences: Vec<(String, String)>,
}

/// Reads a table's writable columns, primary key and sequences from the catalog.
///
/// # Errors
/// Fails when the table does not exist or the connection is broken.
pub async fn describe<C: Conn>(conn: &mut C, table: &str) -> Result<Shape, PgError> {
    let reg = Value::String(quote_ident(table));
    let cols = conn.query(COLUMNS_SQL, std::slice::from_ref(&reg)).await?;
    let mut columns = Vec::with_capacity(cols.rows.len());
    let mut identity_always = false;
    for row in &cols.rows {
        if cell(row, 1) == "a" {
            identity_always = true;
        }
        columns.push(cell(row, 0));
    }
    let pk = conn.query(PK_SQL, std::slice::from_ref(&reg)).await?;
    let primary_key = pk.rows.first().map(|row| cell(row, 0));
    let pk_cols = conn
        .query(PK_COLUMNS_SQL, std::slice::from_ref(&reg))
        .await?;
    let primary_key_columns = pk_cols.rows.iter().map(|row| cell(row, 0)).collect();
    let seq = conn
        .query(SEQUENCES_SQL, std::slice::from_ref(&reg))
        .await?;
    let sequences = seq
        .rows
        .iter()
        .map(|row| (cell(row, 0), cell(row, 1)))
        .collect();
    Ok(Shape {
        columns,
        identity_always,
        primary_key,
        primary_key_columns,
        sequences,
    })
}

/// The text of one cell, or empty for SQL null.
fn cell(row: &[Option<String>], i: usize) -> String {
    row.get(i).and_then(Clone::clone).unwrap_or_default()
}

/// The batch insert. `$1` is a JSON array of rows, expanded against the table's own column types.
#[must_use]
pub fn insert_sql(table: &str, shape: &Shape) -> String {
    let t = quote_ident(table);
    let cols = shape
        .columns
        .iter()
        .map(|c| quote_ident(c))
        .collect::<Vec<_>>()
        .join(", ");
    let overriding = if shape.identity_always {
        " OVERRIDING SYSTEM VALUE"
    } else {
        ""
    };
    let conflict = shape.primary_key.as_ref().map_or_else(String::new, |pk| {
        format!(" ON CONFLICT ON CONSTRAINT {} DO NOTHING", quote_ident(pk))
    });
    format!(
        "INSERT INTO {t} ({cols}){overriding} SELECT {cols} FROM jsonb_populate_recordset(NULL::{t}, $1::jsonb){conflict} RETURNING 1"
    )
}

/// Counts the rows of a batch whose native row, found by primary key, differs in any writable
/// column. Runs after the batch insert, so rows the batch inserted match themselves and count 0.
/// `$1` is the batch's JSON array, as for `insert_sql`.
#[must_use]
pub fn differ_sql(table: &str, shape: &Shape) -> String {
    let t = quote_ident(table);
    let join = shape
        .primary_key_columns
        .iter()
        .map(|c| format!("n.{0} = s.{0}", quote_ident(c)))
        .collect::<Vec<_>>()
        .join(" AND ");
    let native = shape
        .columns
        .iter()
        .map(|c| format!("n.{}", quote_ident(c)))
        .collect::<Vec<_>>()
        .join(", ");
    let source = shape
        .columns
        .iter()
        .map(|c| format!("s.{}", quote_ident(c)))
        .collect::<Vec<_>>()
        .join(", ");
    format!(
        "WITH s AS (SELECT * FROM jsonb_populate_recordset(NULL::{t}, $1::jsonb)) \
         SELECT count(*)::bigint FROM s JOIN {t} n ON {join} \
         WHERE ({native}) IS DISTINCT FROM ({source})"
    )
}

/// Moves one sequence past the table's largest value. It never moves backwards, and it never goes
/// below the sequence's MINVALUE. `$1` is the sequence.
#[must_use]
pub fn reset_sql(table: &str, column: &str) -> String {
    let t = quote_ident(table);
    let c = quote_ident(column);
    format!(
        "SELECT setval($1::regclass, GREATEST((SELECT COALESCE(MAX({c}), 0)::bigint + 1 FROM {t}), \
         COALESCE(pg_sequence_last_value($1::regclass) + 1, 0), \
         (SELECT seqmin FROM pg_sequence WHERE seqrelid = $1::regclass)), false)"
    )
}

/// One JSON array of rows, sent as one parameter.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Batch {
    /// The rows as a JSON array.
    pub json: String,
    /// How many rows the array holds.
    pub rows: usize,
}

/// Packs rows into batches of at most `budget` bytes. A row bigger than the budget goes alone.
///
/// # Errors
/// Fails when a row cannot be serialised.
pub fn pack_batches(rows: &[Value], budget: usize) -> Result<Vec<Batch>, PgError> {
    let mut out = Vec::new();
    let mut body = String::new();
    let mut count = 0;
    for row in rows {
        let text = serde_json::to_string(row).map_err(|e| PgError::local(e.to_string()))?;
        if count > 0 && body.len() + text.len() + 2 > budget {
            out.push(Batch {
                json: format!("[{body}]"),
                rows: count,
            });
            body.clear();
            count = 0;
        }
        if count > 0 {
            body.push(',');
        }
        body.push_str(&text);
        count += 1;
    }
    if count > 0 {
        out.push(Batch {
            json: format!("[{body}]"),
            rows: count,
        });
    }
    Ok(out)
}

/// The rows of one table, as the import reports them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TableReport {
    /// The table name.
    pub table: String,
    /// Rows written by this import.
    pub inserted: u64,
    /// Rows skipped because a native row already has the same primary key.
    pub skipped: u64,
    /// True when the ledger already had the table, so nothing ran.
    pub already_done: bool,
}

/// Creates the ledger if it is missing.
///
/// # Errors
/// Fails when the server refuses the DDL or the connection is broken.
pub async fn ensure_ledger<C: Conn>(conn: &mut C) -> Result<(), PgError> {
    conn.exec(LEDGER_SQL).await
}

/// The tables the ledger has.
///
/// # Errors
/// Fails when the query fails or the connection is broken.
pub async fn done_tables<C: Conn>(conn: &mut C) -> Result<BTreeSet<String>, PgError> {
    let out = conn
        .query("SELECT table_name FROM wf_import.done", &[])
        .await?;
    Ok(out.rows.iter().map(|row| cell(row, 0)).collect())
}

/// Imports one table in one transaction, then records it in the ledger in that same transaction.
/// A table the ledger already has is skipped. On any failure the transaction is rolled back and
/// the table stays pending.
///
/// # Errors
/// Fails when the table is missing or has no writable columns, a batch is refused (for example a
/// non-primary-key unique violation), or the COMMIT does not commit.
pub async fn import_table<C: Conn>(
    conn: &mut C,
    table: &str,
    rows: &[Value],
) -> Result<TableReport, PgError> {
    ensure_ledger(conn).await?;
    conn.exec("BEGIN").await?;
    let outcome = match import_in_transaction(conn, table, rows).await {
        Ok(report) => conn.commit().await.map(|()| report),
        Err(e) => Err(e),
    };
    if outcome.is_err() {
        let _ = conn.exec("ROLLBACK").await;
    }
    outcome
}

/// Refuses the table when a skipped row differs from the native row with the same key, so a
/// conflicting row is never silently dropped.
async fn refuse_differing_rows<C: Conn>(
    conn: &mut C,
    table: &str,
    shape: &Shape,
    json: String,
) -> Result<(), PgError> {
    let differ = conn
        .query(&differ_sql(table, shape), &[Value::String(json)])
        .await?;
    let differing = differ
        .rows
        .first()
        .and_then(|row| cell(row, 0).parse::<u64>().ok())
        .unwrap_or(u64::MAX);
    if differing > 0 {
        return Err(PgError::local(format!(
            "{table}: {differing} skipped row(s) differ from the native row with the same key; \
             the table was not imported"
        )));
    }
    Ok(())
}

async fn import_in_transaction<C: Conn>(
    conn: &mut C,
    table: &str,
    rows: &[Value],
) -> Result<TableReport, PgError> {
    let name = table.to_owned();
    let done = conn
        .query(
            "SELECT 1 FROM wf_import.done WHERE table_name = $1",
            &[Value::String(name.clone())],
        )
        .await?;
    if !done.rows.is_empty() {
        return Ok(TableReport {
            table: name,
            inserted: 0,
            skipped: 0,
            already_done: true,
        });
    }
    let shape = describe(conn, table).await?;
    if shape.columns.is_empty() {
        return Err(PgError::local(format!("no writable columns for {table}")));
    }
    let sql = insert_sql(table, &shape);
    let mut report = TableReport {
        table: name.clone(),
        inserted: 0,
        skipped: 0,
        already_done: false,
    };
    for batch in pack_batches(rows, BATCH_BYTES)? {
        let got = u64::try_from(
            conn.query(&sql, &[Value::String(batch.json.clone())])
                .await?
                .rows
                .len(),
        )
        .unwrap_or(u64::MAX);
        let sent = u64::try_from(batch.rows).unwrap_or(u64::MAX);
        report.inserted += got;
        let skipped = sent.saturating_sub(got);
        report.skipped += skipped;
        if skipped > 0 {
            refuse_differing_rows(conn, table, &shape, batch.json).await?;
        }
    }
    for (column, sequence) in &shape.sequences {
        let _ = conn
            .query(
                &reset_sql(table, column),
                &[Value::String(sequence.clone())],
            )
            .await?;
    }
    let _ = conn
        .query(
            "INSERT INTO wf_import.done (table_name, row_count) VALUES ($1, $2::bigint)",
            &[Value::String(name), Value::from(report.inserted)],
        )
        .await?;
    Ok(report)
}

/// Imports the tables in the order given (parents first), stopping at the first failure, then
/// writes the marker. The marker is written only when every table is in the ledger.
///
/// # Errors
/// Fails on the first table that fails, or when the marker cannot be written.
pub async fn import_tables<C: Conn>(
    conn: &mut C,
    tables: &[(&str, &[Value])],
    marker: &Path,
) -> Result<Vec<TableReport>, PgError> {
    let mut reports = Vec::with_capacity(tables.len());
    for (table, rows) in tables {
        reports.push(import_table(conn, table, rows).await?);
    }
    let done = done_tables(conn).await?;
    let names: Vec<&str> = tables.iter().map(|(t, _)| *t).collect();
    write_marker(marker, &names, &done).map_err(|e| PgError::local(e.to_string()))?;
    Ok(reports)
}

/// Writes the done marker, only when every expected table is in `done`. The file is synced.
///
/// # Errors
/// Fails when a table is missing from `done`, or the marker cannot be written.
pub fn write_marker(marker: &Path, expected: &[&str], done: &BTreeSet<String>) -> io::Result<()> {
    if let Some(missing) = expected.iter().find(|t| !done.contains(**t)) {
        return Err(io::Error::other(format!(
            "table {missing} is not in the import ledger"
        )));
    }
    let mut file = File::create(marker)?;
    file.write_all(b"imported\n")?;
    file.sync_all()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::local_pg::TextRows;
    use crate::local_pg::server::PgServer;
    use crate::local_pg::wire::PgConn;
    use serde_json::json;
    use std::path::PathBuf;
    use std::time::Duration;

    const SCHEMA: &str = "CREATE TABLE serial_t (id serial PRIMARY KEY, body text NOT NULL);
        CREATE TABLE ident_t (id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY, body text);
        CREATE TABLE gen_t (id int PRIMARY KEY, a int NOT NULL, b int GENERATED ALWAYS AS (a * 2) STORED);
        CREATE TABLE gen_only (b int GENERATED ALWAYS AS (1) STORED);
        CREATE TABLE log_t (seq serial, body text);
        CREATE TABLE uniq_t (id int PRIMARY KEY, code text UNIQUE);
        CREATE TABLE minv (id bigint GENERATED BY DEFAULT AS IDENTITY (MINVALUE 100 START 100) PRIMARY KEY, body text);";

    /// A real server for one test, or None when `WF_REAL_PG_BIN` is unset (the test then passes
    /// without running, as the other real-Postgres tests do).
    async fn start(name: &str) -> Result<Option<(PgServer, PathBuf)>, PgError> {
        let Some(bin) = std::env::var_os("WF_REAL_PG_BIN").map(PathBuf::from) else {
            return Ok(None);
        };
        if let Some(exe) = std::env::var_os("WF_COMSPEC_SHIM_EXE") {
            crate::local_pg::comspec::enable(exe.into());
        }
        let root = std::env::temp_dir().join(format!("wf-import-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let server = PgServer::start(&bin, &root).await?;
        Ok(Some((server, root)))
    }

    async fn finish(
        server: PgServer,
        root: PathBuf,
        result: Result<(), PgError>,
    ) -> Result<(), PgError> {
        let stopped = server.stop().await;
        let _ = std::fs::remove_dir_all(&root);
        result?;
        stopped
    }

    async fn scalar(conn: &mut PgConn, sql: &str) -> Result<String, PgError> {
        let out = conn.query(sql, &[]).await?;
        Ok(out.rows.first().map(|r| cell(r, 0)).unwrap_or_default())
    }

    fn rows(n: usize, body: impl Fn(usize) -> Value) -> Vec<Value> {
        (0..n).map(body).collect()
    }

    /// A connection that can be told to fail at a chosen point of the import.
    struct Faulty {
        conn: PgConn,
        admin: PgConn,
        pid: String,
        fault: Option<Fault>,
        inserts: usize,
    }

    #[derive(Clone, Copy)]
    enum Fault {
        /// Terminates this backend on the n-th INSERT, as an admin would.
        TerminateAtInsert(usize),
        /// Lets the server commit, then reports the connection as lost.
        CommitThenFail,
    }

    impl Faulty {
        async fn open(server: &PgServer, fault: Fault) -> Result<Self, PgError> {
            let mut conn = server.connect().await?;
            let pid = scalar(&mut conn, "SELECT pg_backend_pid()").await?;
            Ok(Self {
                conn,
                admin: server.connect().await?,
                pid,
                fault: Some(fault),
                inserts: 0,
            })
        }

        async fn kill(&mut self) -> Result<(), PgError> {
            self.admin
                .exec(&format!("SELECT pg_terminate_backend({})", self.pid))
                .await?;
            let probe = format!(
                "SELECT count(*) FROM pg_stat_activity WHERE pid = {}",
                self.pid
            );
            for _ in 0..200 {
                if scalar(&mut self.admin, &probe).await? == "0" {
                    return Ok(());
                }
                tokio::time::sleep(Duration::from_millis(25)).await;
            }
            Err(PgError::local("backend did not exit"))
        }
    }

    impl Conn for Faulty {
        async fn exec(&mut self, sql: &str) -> Result<(), PgError> {
            self.conn.exec(sql).await
        }

        async fn query(&mut self, sql: &str, params: &[Value]) -> Result<TextRows, PgError> {
            if sql.contains("jsonb_populate_recordset") {
                self.inserts += 1;
                if let Some(Fault::TerminateAtInsert(n)) = self.fault
                    && self.inserts == n
                {
                    self.fault = None;
                    self.kill().await?;
                }
            }
            self.conn.query(sql, params).await
        }

        async fn commit(&mut self) -> Result<(), PgError> {
            if let Some(Fault::CommitThenFail) = self.fault {
                self.fault = None;
                self.conn.commit().await?;
                return Err(PgError::connection("connection lost after COMMIT"));
            }
            self.conn.commit().await
        }
    }

    #[test]
    fn identifiers_with_quotes_and_spaces_are_quoted() {
        // Guards: a table or column name with a quote or a space breaking the SQL.
        assert_eq!(quote_ident("my \"t\""), "\"my \"\"t\"\"\"");
        let shape = Shape {
            columns: vec!["a b".into(), "id".into()],
            identity_always: false,
            primary_key: Some("my pk".into()),
            primary_key_columns: vec!["id".into()],
            sequences: vec![],
        };
        let sql = insert_sql("my \"t\"", &shape);
        assert!(sql.starts_with("INSERT INTO \"my \"\"t\"\"\" (\"a b\", \"id\") SELECT"));
        assert!(sql.contains("jsonb_populate_recordset(NULL::\"my \"\"t\"\"\", $1::jsonb)"));
        assert!(sql.ends_with("ON CONFLICT ON CONSTRAINT \"my pk\" DO NOTHING RETURNING 1"));
    }

    #[test]
    fn byte_budget_batches_split_by_bytes_and_send_an_oversize_row_alone() {
        // Guards: batches sized by row count, so a few huge rows make one oversized INSERT.
        let mib = 1024 * 1024;
        let big = |n: usize| json!({ "body": "x".repeat(n) });
        let src = vec![
            big(3 * mib),
            big(3 * mib),
            big(3 * mib),
            big(3 * mib),
            big(9 * mib),
            json!({ "body": "small" }),
        ];
        let got: Vec<usize> = pack_batches(&src, BATCH_BYTES)
            .unwrap()
            .iter()
            .map(|b| b.rows)
            .collect();
        assert_eq!(got, [2, 2, 1, 1]);
    }

    #[test]
    fn marker_is_written_only_when_every_expected_table_is_in_the_ledger() {
        // Guards: local-pg.imported written with a table still pending, so the app never sees a
        // partial import as done.
        let dir = std::env::temp_dir().join(format!("wf-import-marker-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let marker = dir.join("local-pg.imported");
        let _ = std::fs::remove_file(&marker);
        let mut done: BTreeSet<String> = ["notes".to_owned()].into_iter().collect();
        assert!(write_marker(&marker, &["notes", "papers"], &done).is_err());
        assert!(!marker.exists());
        let _ = done.insert("papers".to_owned());
        write_marker(&marker, &["notes", "papers"], &done).unwrap();
        assert!(marker.exists());
    }

    #[tokio::test]
    async fn real_serial_identity_and_generated_columns_import_and_sequences_resume()
    -> Result<(), PgError> {
        // Guards: identity-always rows refused without OVERRIDING, generated columns written
        // (and so refused), and the identity sequence left at 1 so the next insert collides.
        let Some((server, root)) = start("ids").await? else {
            return Ok(());
        };
        let r = async {
            let mut c = server.connect().await?;
            c.exec(SCHEMA).await?;
            let _ = import_table(
                &mut c,
                "serial_t",
                &rows(3, |i| json!({ "id": i + 1, "body": "s" })),
            )
            .await?;
            let _ = import_table(
                &mut c,
                "ident_t",
                &rows(3, |i| json!({ "id": i + 1, "body": "i" })),
            )
            .await?;
            let _ = import_table(
                &mut c,
                "gen_t",
                &rows(3, |i| json!({ "id": i + 1, "a": i + 1, "b": 999 })),
            )
            .await?;
            assert_eq!(
                scalar(&mut c, "SELECT b FROM gen_t WHERE id = 2").await?,
                "4"
            );
            assert_eq!(
                scalar(
                    &mut c,
                    "INSERT INTO serial_t (body) VALUES ('new') RETURNING id"
                )
                .await?,
                "4"
            );
            assert_eq!(
                scalar(
                    &mut c,
                    "INSERT INTO ident_t (body) VALUES ('new') RETURNING id"
                )
                .await?,
                "4"
            );
            assert!(
                import_table(&mut c, "gen_only", &rows(1, |_| json!({ "b": 1 })))
                    .await
                    .is_err()
            );
            Ok::<(), PgError>(())
        }
        .await;
        finish(server, root, r).await
    }

    #[tokio::test]
    async fn real_sequence_reset_never_moves_backwards_and_respects_minvalue() -> Result<(), PgError>
    {
        // Guards: a reset setting the sequence to max+1 even when native rows already used higher
        // keys (moving it backwards), and ignoring MINVALUE.
        let Some((server, root)) = start("seqmove").await? else {
            return Ok(());
        };
        let r = async {
            let mut c = server.connect().await?;
            c.exec(SCHEMA).await?;
            c.exec("SELECT setval(pg_get_serial_sequence('serial_t', 'id'), 50, true)")
                .await?;
            let _ = import_table(
                &mut c,
                "serial_t",
                &rows(3, |i| json!({ "id": i + 1, "body": "s" })),
            )
            .await?;
            assert_eq!(
                scalar(
                    &mut c,
                    "INSERT INTO serial_t (body) VALUES ('n') RETURNING id"
                )
                .await?,
                "51"
            );
            let _ = import_table(
                &mut c,
                "minv",
                &rows(3, |i| json!({ "id": i + 1, "body": "m" })),
            )
            .await?;
            assert_eq!(
                scalar(&mut c, "INSERT INTO minv (body) VALUES ('n') RETURNING id").await?,
                "100"
            );
            Ok::<(), PgError>(())
        }
        .await;
        finish(server, root, r).await
    }

    #[tokio::test]
    async fn real_pk_less_table_crash_before_commit_leaves_no_rows_and_rerun_matches_source()
    -> Result<(), PgError> {
        // Guards: a half-written keyless table left behind by a crash mid-import, which a rerun
        // would then duplicate.
        let Some((server, root)) = start("pkless").await? else {
            return Ok(());
        };
        let r = async {
            let mut c = server.connect().await?;
            c.exec(SCHEMA).await?;
            drop(c);
            let src = rows(10, |i| json!({ "seq": i + 1, "body": "x".repeat(1 << 20) }));
            assert!(
                pack_batches(&src, BATCH_BYTES)?.len() >= 2,
                "needs two INSERTs"
            );
            let mut f = Faulty::open(&server, Fault::TerminateAtInsert(2)).await?;
            assert!(import_table(&mut f, "log_t", &src).await.is_err());
            let mut c = server.connect().await?;
            assert_eq!(scalar(&mut c, "SELECT count(*) FROM log_t").await?, "0");
            assert_eq!(
                scalar(&mut c, "SELECT count(*) FROM wf_import.done").await?,
                "0"
            );
            let again = import_table(&mut c, "log_t", &src).await?;
            assert_eq!(again.inserted, 10);
            assert_eq!(scalar(&mut c, "SELECT count(*) FROM log_t").await?, "10");
            Ok::<(), PgError>(())
        }
        .await;
        finish(server, root, r).await
    }

    #[tokio::test]
    async fn real_dropped_connection_on_a_keyed_table_leaves_nothing_and_rerun_matches()
    -> Result<(), PgError> {
        // Guards: a dropped connection leaving some rows committed for a table with a key.
        let Some((server, root)) = start("drop").await? else {
            return Ok(());
        };
        let r = async {
            let mut c = server.connect().await?;
            c.exec(SCHEMA).await?;
            drop(c);
            let src = rows(3, |i| json!({ "id": i + 1, "body": "s" }));
            let mut f = Faulty::open(&server, Fault::TerminateAtInsert(1)).await?;
            assert!(import_table(&mut f, "serial_t", &src).await.is_err());
            let mut c = server.connect().await?;
            assert_eq!(scalar(&mut c, "SELECT count(*) FROM serial_t").await?, "0");
            let again = import_table(&mut c, "serial_t", &src).await?;
            assert_eq!(again.inserted, 3);
            Ok::<(), PgError>(())
        }
        .await;
        finish(server, root, r).await
    }

    #[tokio::test]
    async fn real_commit_that_succeeds_then_fails_on_the_client_does_not_duplicate_on_rerun()
    -> Result<(), PgError> {
        // Guards: a crash after COMMIT but before the ledger is saved, which made a rerun insert
        // a keyless table's rows a second time. The ledger row is in the same transaction.
        let Some((server, root)) = start("after").await? else {
            return Ok(());
        };
        let r = async {
            let mut c = server.connect().await?;
            c.exec(SCHEMA).await?;
            drop(c);
            let src = rows(5, |i| json!({ "seq": i + 1, "body": "x" }));
            let mut f = Faulty::open(&server, Fault::CommitThenFail).await?;
            assert!(import_table(&mut f, "log_t", &src).await.is_err());
            let mut c = server.connect().await?;
            assert_eq!(scalar(&mut c, "SELECT count(*) FROM log_t").await?, "5");
            let again = import_table(&mut c, "log_t", &src).await?;
            assert!(again.already_done, "the ledger row committed with the rows");
            assert_eq!(scalar(&mut c, "SELECT count(*) FROM log_t").await?, "5");
            Ok::<(), PgError>(())
        }
        .await;
        finish(server, root, r).await
    }

    #[tokio::test]
    async fn real_keyed_table_keeps_native_rows_and_counts_skipped_keys() -> Result<(), PgError> {
        // Guards: a non-empty native DB losing its own row, or duplicating an imported one.
        let Some((server, root)) = start("keep").await? else {
            return Ok(());
        };
        let r = async {
            let mut c = server.connect().await?;
            c.exec(SCHEMA).await?;
            c.exec("INSERT INTO serial_t (id, body) VALUES (1, 'native')")
                .await?;
            let src = vec![
                json!({ "id": 1, "body": "native" }),
                json!({ "id": 2, "body": "b" }),
            ];
            let report = import_table(&mut c, "serial_t", &src).await?;
            assert_eq!((report.inserted, report.skipped), (1, 1));
            assert_eq!(
                scalar(&mut c, "SELECT body FROM serial_t WHERE id = 1").await?,
                "native"
            );
            Ok::<(), PgError>(())
        }
        .await;
        finish(server, root, r).await
    }

    #[tokio::test]
    async fn real_keyed_table_fails_when_a_skipped_row_differs() -> Result<(), PgError> {
        // Guards: a skipped old row that differs from the native row with its key being dropped
        // without a word. The table must fail and roll back, leaving the native row and no ledger row.
        let Some((server, root)) = start("differ").await? else {
            return Ok(());
        };
        let r = async {
            let mut c = server.connect().await?;
            c.exec(SCHEMA).await?;
            c.exec("INSERT INTO serial_t (id, body) VALUES (1, 'native')")
                .await?;
            let src = vec![
                json!({ "id": 1, "body": "old" }),
                json!({ "id": 2, "body": "b" }),
            ];
            let err = import_table(&mut c, "serial_t", &src).await.unwrap_err();
            assert!(err.to_string().contains("serial_t"), "{err}");
            assert!(err.to_string().contains("1 skipped row"), "{err}");
            assert_eq!(scalar(&mut c, "SELECT count(*) FROM serial_t").await?, "1");
            assert_eq!(
                scalar(&mut c, "SELECT body FROM serial_t WHERE id = 1").await?,
                "native"
            );
            assert_eq!(
                scalar(&mut c, "SELECT count(*) FROM wf_import.done").await?,
                "0"
            );
            Ok::<(), PgError>(())
        }
        .await;
        finish(server, root, r).await
    }

    #[tokio::test]
    async fn real_non_primary_key_unique_conflict_is_an_error_not_skipped() -> Result<(), PgError> {
        // Guards: ON CONFLICT with no target swallowing a clash on another UNIQUE column, losing
        // an old row without a word.
        let Some((server, root)) = start("uniq").await? else {
            return Ok(());
        };
        let r = async {
            let mut c = server.connect().await?;
            c.exec(SCHEMA).await?;
            c.exec("INSERT INTO uniq_t VALUES (1, 'X')").await?;
            let src = vec![json!({ "id": 2, "code": "X" })];
            assert!(import_table(&mut c, "uniq_t", &src).await.is_err());
            assert_eq!(scalar(&mut c, "SELECT count(*) FROM uniq_t").await?, "1");
            assert_eq!(
                scalar(&mut c, "SELECT count(*) FROM wf_import.done").await?,
                "0"
            );
            Ok::<(), PgError>(())
        }
        .await;
        finish(server, root, r).await
    }

    #[tokio::test]
    async fn real_commit_reports_the_rollback_tag_of_an_aborted_transaction() -> Result<(), PgError>
    {
        // Guards: COMMIT on an aborted transaction (the server answers ROLLBACK) reported as success.
        let Some((server, root)) = start("tag").await? else {
            return Ok(());
        };
        let r = async {
            let mut c = server.connect().await?;
            c.exec(SCHEMA).await?;
            c.exec("INSERT INTO uniq_t VALUES (1, 'a')").await?;
            c.exec("BEGIN").await?;
            assert!(c.exec("INSERT INTO uniq_t VALUES (1, 'b')").await.is_err());
            let err = c
                .commit()
                .await
                .expect_err("COMMIT on an aborted transaction must not report success");
            assert!(err.message.contains("ROLLBACK"), "{err}");
            Ok::<(), PgError>(())
        }
        .await;
        finish(server, root, r).await
    }

    #[tokio::test]
    async fn real_orchestrator_stops_at_a_failing_table_and_writes_the_marker_last()
    -> Result<(), PgError> {
        // Guards: the marker written while a table is still missing, or later tables imported
        // after an earlier table failed.
        let Some((server, root)) = start("orch").await? else {
            return Ok(());
        };
        let r = async {
            let mut c = server.connect().await?;
            c.exec(SCHEMA).await?;
            let marker = root.join("local-pg.imported");
            let serial = rows(3, |i| json!({ "id": i + 1, "body": "s" }));
            let log = rows(2, |i| json!({ "seq": i + 1, "body": "l" }));
            let plan: Vec<(&str, &[Value])> = vec![
                ("serial_t", serial.as_slice()),
                ("nope", serial.as_slice()),
                ("log_t", log.as_slice()),
            ];
            assert!(import_tables(&mut c, &plan, &marker).await.is_err());
            assert!(!marker.exists(), "no marker while a table is missing");
            assert_eq!(
                scalar(&mut c, "SELECT count(*) FROM log_t").await?,
                "0",
                "later tables not started"
            );
            c.exec("CREATE TABLE nope (id int PRIMARY KEY, body text)")
                .await?;
            let plan: Vec<(&str, &[Value])> = vec![
                ("serial_t", serial.as_slice()),
                ("nope", serial.as_slice()),
                ("log_t", log.as_slice()),
            ];
            let reports = import_tables(&mut c, &plan, &marker).await?;
            assert_eq!(reports.len(), 3);
            assert!(marker.exists());
            assert_eq!(
                scalar(&mut c, "SELECT count(*) FROM serial_t").await?,
                "3",
                "no duplicates on rerun"
            );
            Ok::<(), PgError>(())
        }
        .await;
        finish(server, root, r).await
    }

    #[tokio::test]
    async fn real_table_and_column_names_with_quotes_and_dollar_signs_import() -> Result<(), PgError>
    {
        // Guards: a table name with quotes or $$ breaking the reset SQL (the old DO block) or the
        // insert, so the table is unusable.
        let Some((server, root)) = start("names").await? else {
            return Ok(());
        };
        let r = async {
            let mut c = server.connect().await?;
            c.exec(
                "CREATE TABLE \"we\"\"ird $$ name\" (\"my id\" serial PRIMARY KEY, \"b d\" text)",
            )
            .await?;
            let src = rows(2, |i| json!({ "my id": i + 1, "b d": "v" }));
            let report = import_table(&mut c, "we\"ird $$ name", &src).await?;
            assert_eq!(report.inserted, 2);
            assert_eq!(
                scalar(
                    &mut c,
                    "INSERT INTO \"we\"\"ird $$ name\" (\"b d\") VALUES ('n') RETURNING \"my id\""
                )
                .await?,
                "3"
            );
            Ok::<(), PgError>(())
        }
        .await;
        finish(server, root, r).await
    }
}
