//! One-time import of the old PGlite database into the native one, on the owner connection.
//!
//! Each table is one transaction: `begin_table`, any number of `write_batch`, then `commit_table`,
//! which also resets the table's serial sequences. A crash before the commit rolls the whole table
//! back, so a rerun never duplicates rows, even for a table with no key. Keyed tables use
//! `ON CONFLICT DO NOTHING`, so rows already in the native DB are kept and never overwritten.
//!
//! The ledger lists the finished tables. The done marker is written only after every expected
//! table is in it, so a partial import is never marked done.

use std::collections::BTreeSet;
use std::fs;
use std::io;
use std::path::Path;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::{Conn, PgError};

/// Quotes a SQL identifier: `my "t"` becomes `"my ""t"""`.
#[must_use]
pub fn quote_ident(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

/// Quotes a SQL string literal.
fn literal(text: &str) -> String {
    format!("'{}'", text.replace('\'', "''"))
}

/// The batch insert: JSON rows are expanded against the table's own column types, and keys that
/// already exist are left alone.
#[must_use]
pub fn insert_sql(table: &str, columns: &[String]) -> String {
    let t = quote_ident(table);
    let cols = columns
        .iter()
        .map(|c| quote_ident(c))
        .collect::<Vec<_>>()
        .join(", ");
    format!(
        "INSERT INTO {t} ({cols}) SELECT {cols} FROM jsonb_populate_recordset(NULL::{t}, $1::jsonb) ON CONFLICT DO NOTHING"
    )
}

/// Sets each serial column's sequence past the table's largest value, so new rows do not clash.
#[must_use]
pub fn reset_sequences_sql(table: &str) -> String {
    let reg = literal(&quote_ident(table));
    format!(
        "DO $$ DECLARE r record; BEGIN FOR r IN SELECT a.attname FROM pg_attrdef d \
         JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum \
         WHERE d.adrelid = to_regclass({reg}) AND pg_get_expr(d.adbin, d.adrelid) LIKE 'nextval(%' \
         LOOP EXECUTE format('SELECT setval(pg_get_serial_sequence(%L, %L), COALESCE(MAX(%I), 0) + 1, false) FROM %s', \
         {reg}, r.attname, r.attname, to_regclass({reg})); END LOOP; END $$"
    )
}

/// Starts the table's transaction.
///
/// # Errors
/// Fails when the server refuses `BEGIN` or the connection is broken.
pub async fn begin_table<C: Conn>(conn: &mut C) -> Result<(), PgError> {
    conn.exec("BEGIN").await
}

/// Inserts one batch of JSON rows into the open table transaction.
///
/// # Errors
/// Fails on an empty column list, a bad row, or a server error (the caller then aborts the table).
pub async fn write_batch<C: Conn>(
    conn: &mut C,
    table: &str,
    columns: &[String],
    rows: &[Value],
) -> Result<(), PgError> {
    if columns.is_empty() {
        return Err(PgError::local(format!("no columns to import for {table}")));
    }
    if rows.is_empty() {
        return Ok(());
    }
    let body = serde_json::to_string(rows).map_err(|e| PgError::local(e.to_string()))?;
    conn.query(&insert_sql(table, columns), &[Value::String(body)])
        .await
        .map(|_| ())
}

/// Resets the table's sequences and commits its transaction.
///
/// # Errors
/// Fails when the reset or the commit fails; the caller then aborts the table.
pub async fn commit_table<C: Conn>(conn: &mut C, table: &str) -> Result<(), PgError> {
    conn.exec(&reset_sequences_sql(table)).await?;
    conn.exec("COMMIT").await
}

/// Rolls the table's transaction back, dropping every row written since `begin_table`.
pub async fn abort_table<C: Conn>(conn: &mut C) {
    let _ = conn.exec("ROLLBACK").await;
}

/// The tables that finished importing. Stored as JSON next to the marker.
#[derive(Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct Ledger {
    done: BTreeSet<String>,
}

impl Ledger {
    /// Reads the ledger; a missing file is an empty ledger.
    ///
    /// # Errors
    /// Fails when the file exists but cannot be read or parsed.
    pub fn load(path: &Path) -> io::Result<Self> {
        match fs::read_to_string(path) {
            Ok(text) => serde_json::from_str(&text).map_err(io::Error::other),
            Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(Self::default()),
            Err(e) => Err(e),
        }
    }

    /// Writes the ledger atomically: a temp file, then a rename over the old one.
    ///
    /// # Errors
    /// Fails when the file cannot be written or renamed.
    pub fn save(&self, path: &Path) -> io::Result<()> {
        let text = serde_json::to_string(self).map_err(io::Error::other)?;
        let tmp = path.with_extension("json.tmp");
        fs::write(&tmp, text)?;
        fs::rename(&tmp, path)
    }

    /// Whether `table` has finished importing.
    #[must_use]
    pub fn is_done(&self, table: &str) -> bool {
        self.done.contains(table)
    }

    /// Records `table` as finished.
    pub fn mark_done(&mut self, table: &str) {
        let _ = self.done.insert(table.to_owned());
    }
}

/// Writes the done marker, only when every expected table is in the ledger.
///
/// # Errors
/// Fails when a table is still pending, or when the marker cannot be written.
pub fn finish(ledger: &Ledger, expected: &[&str], marker: &Path) -> io::Result<()> {
    if let Some(missing) = expected.iter().find(|t| !ledger.is_done(t)) {
        return Err(io::Error::other(format!("table {missing} is not imported yet")));
    }
    fs::write(marker, "")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    /// A fake connection with transactions. Rows go to a per-table pending list, become visible on
    /// COMMIT and are dropped on ROLLBACK or when the connection is dropped mid-transaction. A
    /// `key` column, when a table has one, makes a repeat row a no-op, as ON CONFLICT would.
    #[derive(Default)]
    struct Fake {
        committed: HashMap<String, Vec<Value>>,
        pending: Vec<(String, Vec<Value>)>,
        in_tx: bool,
        /// Keys per table (column name), empty for a table with no key.
        keys: HashMap<String, String>,
        fail_after_batches: Option<usize>,
        batches: usize,
        statements: Vec<String>,
    }

    fn table_of(sql: &str) -> String {
        // "INSERT INTO <ident> (" with the identifier quoted and "" escapes.
        let rest = sql.strip_prefix("INSERT INTO \"").expect("insert prefix");
        let mut out = String::new();
        let mut chars = rest.chars().peekable();
        while let Some(c) = chars.next() {
            if c == '"' {
                if chars.peek() == Some(&'"') {
                    let _ = chars.next();
                    out.push('"');
                } else {
                    break;
                }
            } else {
                out.push(c);
            }
        }
        out
    }

    impl Conn for Fake {
        async fn exec(&mut self, sql: &str) -> Result<(), PgError> {
            self.statements.push(sql.to_owned());
            match sql {
                "BEGIN" => {
                    self.in_tx = true;
                    self.pending.clear();
                }
                "COMMIT" => {
                    for (table, rows) in self.pending.drain(..) {
                        self.committed.entry(table).or_default().extend(rows);
                    }
                    self.in_tx = false;
                }
                "ROLLBACK" => {
                    self.pending.clear();
                    self.in_tx = false;
                }
                _ => {}
            }
            Ok(())
        }

        async fn query(
            &mut self,
            sql: &str,
            params: &[Value],
        ) -> Result<super::super::TextRows, PgError> {
            self.statements.push(sql.to_owned());
            self.batches += 1;
            if self.fail_after_batches.is_some_and(|n| self.batches > n) {
                return Err(PgError::local("simulated crash"));
            }
            let table = table_of(sql);
            let rows: Vec<Value> = serde_json::from_str(params[0].as_str().unwrap()).unwrap();
            let key = self.keys.get(&table).cloned();
            let existing: Vec<Value> = self.committed.get(&table).cloned().unwrap_or_default();
            for row in rows {
                if let Some(k) = &key {
                    let dup = existing
                        .iter()
                        .chain(self.pending.iter().filter(|(t, _)| *t == table).flat_map(|(_, r)| r))
                        .any(|r| r[k] == row[k]);
                    if dup {
                        continue;
                    }
                }
                self.pending.push((table.clone(), vec![row]));
            }
            Ok(super::super::TextRows::default())
        }
    }

    fn cols(names: &[&str]) -> Vec<String> {
        names.iter().map(|s| (*s).to_owned()).collect()
    }

    fn rows(n: usize) -> Vec<Value> {
        (0..n).map(|i| serde_json::json!({ "id": i, "v": "x" })).collect()
    }

    /// Imports one table in one transaction, in batches of `size`.
    async fn import(fake: &mut Fake, table: &str, src: &[Value], size: usize) -> Result<(), PgError> {
        let c = cols(&["id", "v"]);
        begin_table(fake).await?;
        for chunk in src.chunks(size) {
            if let Err(e) = write_batch(fake, table, &c, chunk).await {
                abort_table(fake).await;
                return Err(e);
            }
        }
        commit_table(fake, table).await
    }

    #[tokio::test]
    async fn import_commits_every_row_once() {
        let mut fake = Fake::default();
        let src = rows(12_000);
        import(&mut fake, "notes", &src, 5_000).await.unwrap();
        assert_eq!(fake.committed["notes"].len(), 12_000);
        assert!(!fake.in_tx);
    }

    #[tokio::test]
    async fn crash_before_commit_on_pk_less_table_leaves_no_rows_and_rerun_matches_source() {
        // Guards: a resume re-inserting rows from a half-written table (no key to dedupe on).
        let mut fake = Fake { fail_after_batches: Some(2), ..Fake::default() };
        let src = rows(12_000);
        assert!(import(&mut fake, "events", &src, 5_000).await.is_err());
        assert!(fake.committed.get("events").is_none(), "rolled back, nothing visible");

        fake.fail_after_batches = None;
        import(&mut fake, "events", &src, 5_000).await.unwrap();
        assert_eq!(fake.committed["events"].len(), src.len(), "row count equals source");
    }

    #[tokio::test]
    async fn keyed_table_keeps_native_rows_and_adds_only_new_ones() {
        // Guards: a non-empty native DB losing or duplicating rows on import.
        let mut fake = Fake::default();
        let _ = fake.keys.insert("papers".into(), "id".into());
        let _ = fake.committed.insert(
            "papers".into(),
            vec![serde_json::json!({ "id": 1, "v": "native-edit" })],
        );
        let src = rows(3);
        import(&mut fake, "papers", &src, 10).await.unwrap();
        let got = &fake.committed["papers"];
        assert_eq!(got.len(), 3, "old id 1 is skipped, ids 0 and 2 added");
        assert_eq!(got[0]["v"], "native-edit", "the native row is not overwritten");
    }

    #[test]
    fn identifiers_with_quotes_and_spaces_are_quoted() {
        // Guards: a table or column name with a quote or space breaking the SQL.
        assert_eq!(quote_ident("my \"t\""), "\"my \"\"t\"\"\"");
        let sql = insert_sql("my \"t\"", &cols(&["a b", "id"]));
        assert!(sql.starts_with("INSERT INTO \"my \"\"t\"\"\" (\"a b\", \"id\")"));
        assert!(sql.contains("jsonb_populate_recordset(NULL::\"my \"\"t\"\"\", $1::jsonb)"));
        assert!(sql.ends_with("ON CONFLICT DO NOTHING"));
    }

    #[test]
    fn sequence_reset_targets_only_nextval_columns() {
        // Guards: bigserial ids restarting at 1 after import and colliding with imported rows.
        let sql = reset_sequences_sql("notes");
        assert!(sql.contains("LIKE 'nextval(%'"));
        assert!(sql.contains("to_regclass('\"notes\"')"));
    }

    #[tokio::test]
    async fn empty_column_list_is_refused() {
        // Guards: a batch with no known columns inserting nothing and reporting success.
        let mut fake = Fake::default();
        assert!(write_batch(&mut fake, "t", &[], &rows(1)).await.is_err());
    }

    #[test]
    fn ledger_round_trips_and_missing_file_is_empty() {
        // Guards: a resume after restart treating finished tables as pending.
        let dir = std::env::temp_dir().join(format!("wf-import-ledger-{}", std::process::id()));
        let _ = fs::create_dir_all(&dir);
        let path = dir.join("local-pg.import.json");
        let _ = fs::remove_file(&path);
        assert_eq!(Ledger::load(&path).unwrap(), Ledger::default());
        let mut ledger = Ledger::default();
        ledger.mark_done("notes");
        ledger.save(&path).unwrap();
        let back = Ledger::load(&path).unwrap();
        assert!(back.is_done("notes"));
        assert!(!back.is_done("papers"));
    }

    #[test]
    fn marker_is_written_only_after_every_table_is_done() {
        // Guards: local-pg.imported written with a table still pending, so it is never imported.
        let dir = std::env::temp_dir().join(format!("wf-import-marker-{}", std::process::id()));
        let _ = fs::create_dir_all(&dir);
        let marker = dir.join("local-pg.imported");
        let _ = fs::remove_file(&marker);
        let mut ledger = Ledger::default();
        ledger.mark_done("notes");
        assert!(finish(&ledger, &["notes", "papers"], &marker).is_err());
        assert!(!marker.exists());
        ledger.mark_done("papers");
        finish(&ledger, &["notes", "papers"], &marker).unwrap();
        assert!(marker.exists());
    }
}
