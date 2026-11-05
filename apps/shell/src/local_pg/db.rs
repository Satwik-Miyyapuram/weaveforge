//! The app's local database rules, ported from `sidecar/src/local-db.ts` and
//! `packages/core/src/database/local-postgres.ts`: migrations, queries run as a
//! user under RLS, and the device user. Generic over `Conn` so tests use a fake.

use std::collections::HashSet;
use std::path::Path;

use serde_json::Value;

use super::{Conn, PgError, TextRows};

/// The local-only user's id, used until somebody signs in.
pub const LOCAL_USER_ID: &str = "00000000-0000-4000-8000-000000000001";
/// The local-only user's email, written to `auth.users` on every boot.
pub const LOCAL_USER_EMAIL: &str = "local@weaveforge.invalid";

/// Where the record of applied migrations lives; each migration commits with its row.
pub const LEDGER_SQL: &str = r#"
create table if not exists weaveforge_migrations (
  name text primary key,
  applied_at timestamptz not null default now()
)"#;

/// Scaffolding the migrations expect to find already there; runs before them.
pub const LOCAL_BOOTSTRAP_SQL: &str = r#"
create extension if not exists pgcrypto;
do $$ begin
  if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema if not exists auth;
create schema if not exists storage;
create schema if not exists realtime;
create schema if not exists extensions;
grant usage on schema public, auth, storage, realtime to anon, authenticated, service_role;
-- Supabase grants table privileges to these roles by default, so RLS — not the
-- grant — is what a policy test is actually exercising. Without this every
-- query fails with "permission denied" long before a policy is consulted.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  raw_app_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  last_sign_in_at timestamptz
);

-- What PostgREST does per request, and what every policy reads.
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid $$;

create table if not exists storage.buckets (id text primary key, name text, public boolean default false);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text, owner uuid, metadata jsonb, created_at timestamptz default now()
);
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$
  select string_to_array(name, '/') $$;

create table if not exists realtime.messages (
  id uuid primary key default gen_random_uuid(),
  topic text, extension text, payload jsonb, inserted_at timestamptz default now()
);
alter table realtime.messages enable row level security;
create or replace function realtime.topic() returns text language sql stable as $$
  select current_setting('realtime.topic', true) $$;
"#;

/// The cluster-wide roles the schema grants to; `pg_dump` leaves roles out, so a restore makes
/// them first (the same statements as in `LOCAL_BOOTSTRAP_SQL`).
pub const ROLES_SQL: &str = r#"
do $$ begin
  if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
"#;

/// Sets the claim and the role together, inside the transaction the query runs in.
const SET_CONFIG_SQL: &str =
    "select set_config('request.jwt.claims', $1, true), set_config('role', 'authenticated', true)";

/// The `request.jwt.claims` JSON for a user; `None` is a request with no identity, which policies refuse.
///
/// Key order is `sub` then `role`, as `JSON.stringify` produced it.
#[must_use]
pub fn session_claims(user: Option<&str>) -> String {
    match user {
        Some(id) if !id.is_empty() => format!(
            r#"{{"sub":{},"role":"authenticated"}}"#,
            serde_json::to_string(id).unwrap_or_default()
        ),
        _ => r#"{"role":"anon"}"#.to_string(),
    }
}

/// Claims for a request: `None` means no user was given, so the local-only user is used.
#[must_use]
pub fn claims_for(user: Option<Option<&str>>) -> String {
    match user {
        None => session_claims(Some(LOCAL_USER_ID)),
        Some(user) => session_claims(user),
    }
}

/// Postgres 25P02 or "current transaction is aborted": the connection is stuck in a failed transaction.
#[must_use]
pub fn is_aborted_transaction(err: &PgError) -> bool {
    err.code == "25P02"
        || err
            .message
            .to_lowercase()
            .contains("current transaction is aborted")
}

/// Postgres 42P01: the table does not exist.
#[must_use]
pub fn is_undefined_table(err: &PgError) -> bool {
    err.code == "42P01"
}

/// Whether a statement touches the device's sync bookkeeping, which adoption resets.
#[must_use]
pub fn resets_device_user(sql: &str) -> bool {
    let lower = sql.to_lowercase();
    lower.contains("sync_state") || lower.contains("sync_claim")
}

/// Brings the schema up to date and returns the names newly applied.
///
/// The bootstrap and ledger run first; each migration commits together with its ledger row.
///
/// # Errors
/// Fails if bootstrap, ledger or a migration fails; a migration error names the migration.
pub async fn migrate<C: Conn>(
    conn: &mut C,
    migrations: &[(String, String)],
) -> Result<Vec<String>, PgError> {
    let result = migrate_all(conn, migrations).await;
    if result.is_err() {
        let _ = conn.exec("ROLLBACK").await;
    }
    result
}

/// The body of `migrate`, without the rollback on failure.
async fn migrate_all<C: Conn>(
    conn: &mut C,
    migrations: &[(String, String)],
) -> Result<Vec<String>, PgError> {
    conn.exec(LOCAL_BOOTSTRAP_SQL).await?;
    conn.exec(LEDGER_SQL).await?;
    let applied: HashSet<String> = conn
        .query("select name from weaveforge_migrations", &[])
        .await?
        .rows
        .into_iter()
        .filter_map(|row| row.into_iter().next().flatten())
        .collect();
    let mut ran = Vec::new();
    for (name, sql) in migrations {
        if applied.contains(name) {
            continue;
        }
        run_migration(conn, name, sql)
            .await
            .map_err(|err| PgError {
                code: err.code,
                message: format!(
                    "Migration {name} failed on a clean database: {}",
                    err.message
                ),
            })?;
        ran.push(name.clone());
    }
    Ok(ran)
}

/// Runs one migration and its ledger row in one transaction.
async fn run_migration<C: Conn>(conn: &mut C, name: &str, sql: &str) -> Result<(), PgError> {
    conn.exec("BEGIN").await?;
    let _ = conn
        .query(
            "insert into weaveforge_migrations (name) values ($1)",
            &[Value::String(name.to_string())],
        )
        .await?;
    conn.exec(sql).await?;
    conn.exec("COMMIT").await
}

/// Runs one statement as a user, with RLS in force; retries once if the connection was stuck.
///
/// # Errors
/// Fails with the statement's error, or the error from the retry.
pub async fn query_as<C: Conn>(
    conn: &mut C,
    sql: &str,
    params: &[Value],
    user: Option<Option<&str>>,
) -> Result<TextRows, PgError> {
    let claims = claims_for(user);
    let err = match query_once(conn, sql, params, &claims).await {
        Ok(rows) => return Ok(rows),
        Err(err) => err,
    };
    if !clear_aborted(conn, &err).await {
        return Err(err);
    }
    query_once(conn, sql, params, &claims).await
}

/// One statement in its own transaction, with the claims set first.
async fn query_once<C: Conn>(
    conn: &mut C,
    sql: &str,
    params: &[Value],
    claims: &str,
) -> Result<TextRows, PgError> {
    // A failed BEGIN leaves nothing open to roll back.
    conn.exec("BEGIN").await?;
    match run_in_tx(conn, sql, params, claims).await {
        Ok(rows) => Ok(rows),
        Err(err) => {
            let _ = conn.exec("ROLLBACK").await;
            Err(err)
        }
    }
}

/// The statements inside `query_once`'s transaction, committed at the end.
async fn run_in_tx<C: Conn>(
    conn: &mut C,
    sql: &str,
    params: &[Value],
    claims: &str,
) -> Result<TextRows, PgError> {
    let _ = conn
        .query(SET_CONFIG_SQL, &[Value::String(claims.to_string())])
        .await?;
    let rows = conn.query(sql, params).await?;
    conn.exec("COMMIT").await?;
    Ok(rows)
}

/// Ends an aborted transaction so the statement can run again; `false` if the error is not that or the ROLLBACK fails.
async fn clear_aborted<C: Conn>(conn: &mut C, err: &PgError) -> bool {
    is_aborted_transaction(err) && conn.exec("ROLLBACK").await.is_ok()
}

/// Makes sure the local-only user exists as a row, since foreign keys point at `auth.users`.
///
/// # Errors
/// Fails with the insert's error, or the error from the retry.
pub async fn ensure_local_user<C: Conn>(conn: &mut C) -> Result<(), PgError> {
    const SQL: &str =
        "insert into auth.users (id, email) values ($1, $2) on conflict (id) do nothing";
    let params = [
        Value::String(LOCAL_USER_ID.to_string()),
        Value::String(LOCAL_USER_EMAIL.to_string()),
    ];
    let err = match conn.query(SQL, &params).await {
        Ok(_) => return Ok(()),
        Err(err) => err,
    };
    if !clear_aborted(conn, &err).await {
        return Err(err);
    }
    conn.query(SQL, &params).await.map(|_| ())
}

/// The account this device syncs with, or the local-only user before adoption.
///
/// # Errors
/// Fails on any error other than a missing `sync_state` table.
pub async fn device_user<C: Conn>(conn: &mut C) -> Result<String, PgError> {
    const SQL: &str = "select account_id from sync_state limit 1";
    let result = match conn.query(SQL, &[]).await {
        Ok(rows) => Ok(rows),
        Err(err) => {
            if clear_aborted(conn, &err).await {
                conn.query(SQL, &[]).await
            } else {
                Err(err)
            }
        }
    };
    match result {
        Ok(rows) => Ok(rows
            .rows
            .first()
            .and_then(|row| row.first())
            .and_then(Option::clone)
            .unwrap_or_else(|| LOCAL_USER_ID.to_string())),
        Err(err) if is_undefined_table(&err) => Ok(LOCAL_USER_ID.to_string()),
        Err(err) => {
            let _ = conn.exec("ROLLBACK").await;
            Err(err)
        }
    }
}

/// Reads the `.sql` files of each directory, directories in the order given and files by name.
///
/// Names are `<directory name>/<file name>`, so migrations from two directories stay unique.
///
/// # Errors
/// Fails if a directory or file cannot be read; a missing directory is an error, as in the TS loader.
pub fn migration_files(dirs: &[&Path]) -> std::io::Result<Vec<(String, String)>> {
    let mut out = Vec::new();
    for dir in dirs {
        let base = dir
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default();
        let mut names = Vec::new();
        for entry in std::fs::read_dir(dir)? {
            let file_name = entry?.file_name().to_string_lossy().into_owned();
            if file_name.ends_with(".sql") {
                names.push(file_name);
            }
        }
        names.sort();
        for file_name in names {
            let sql = std::fs::read_to_string(dir.join(&file_name))?;
            out.push((format!("{base}/{file_name}"), sql));
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Records every statement; `fail` errors once per matching prefix; `rows` answers queries by prefix.
    #[derive(Default)]
    struct Fake {
        log: Vec<String>,
        fail: Vec<(String, PgError)>,
        rows: Vec<(String, TextRows)>,
    }

    impl Fake {
        fn take_failure(&mut self, sql: &str) -> Option<PgError> {
            let index = self
                .fail
                .iter()
                .position(|(prefix, _)| sql.starts_with(prefix.as_str()))?;
            Some(self.fail.remove(index).1)
        }
    }

    impl Conn for Fake {
        async fn exec(&mut self, sql: &str) -> Result<(), PgError> {
            self.log.push(sql.to_string());
            match self.take_failure(sql) {
                Some(err) => Err(err),
                None => Ok(()),
            }
        }

        async fn query(&mut self, sql: &str, params: &[Value]) -> Result<TextRows, PgError> {
            self.log.push(format!(
                "{sql} | {}",
                serde_json::to_string(params).unwrap_or_default()
            ));
            if let Some(err) = self.take_failure(sql) {
                return Err(err);
            }
            Ok(self
                .rows
                .iter()
                .find(|(prefix, _)| sql.starts_with(prefix.as_str()))
                .map(|(_, rows)| rows.clone())
                .unwrap_or_default())
        }
    }

    fn named(names: &[&str]) -> TextRows {
        TextRows {
            columns: Vec::new(),
            rows: names
                .iter()
                .map(|name| vec![Some((*name).to_string())])
                .collect(),
        }
    }

    fn pair(name: &str, sql: &str) -> (String, String) {
        (name.to_string(), sql.to_string())
    }

    fn pg_error(code: &str, message: &str) -> PgError {
        PgError {
            code: code.to_string(),
            message: message.to_string(),
        }
    }

    #[test]
    fn local_bootstrap_matches_ts() -> Result<(), Box<dyn std::error::Error>> {
        let text = std::fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../packages/core/src/database/local-postgres.ts"
        ))?;
        let marker = "export const LOCAL_BOOTSTRAP_SQL = `";
        let start = text.find(marker).ok_or("start marker missing")?;
        let body = &text[start + marker.len()..];
        let end = body.find("`;").ok_or("end marker missing")?;
        assert_eq!(&body[..end], LOCAL_BOOTSTRAP_SQL);
        Ok(())
    }

    #[test]
    fn session_claims_shapes() {
        assert_eq!(
            session_claims(Some("u1")),
            r#"{"sub":"u1","role":"authenticated"}"#
        );
        assert_eq!(session_claims(None), r#"{"role":"anon"}"#);
        assert_eq!(claims_for(None), session_claims(Some(LOCAL_USER_ID)));
    }

    #[tokio::test]
    async fn migrate_applies_unapplied_in_order() -> Result<(), Box<dyn std::error::Error>> {
        let mut fake = Fake::default();
        fake.rows.push((
            "select name from weaveforge_migrations".to_string(),
            named(&["a/1.sql"]),
        ));
        let migrations = [
            pair("a/1.sql", "create table s()"),
            pair("a/2.sql", "create table t()"),
        ];
        let ran = migrate(&mut fake, &migrations).await?;
        assert_eq!(ran, vec!["a/2.sql".to_string()]);
        assert_eq!(
            fake.log,
            vec![
                LOCAL_BOOTSTRAP_SQL.to_string(),
                LEDGER_SQL.to_string(),
                "select name from weaveforge_migrations | []".to_string(),
                "BEGIN".to_string(),
                "insert into weaveforge_migrations (name) values ($1) | [\"a/2.sql\"]".to_string(),
                "create table t()".to_string(),
                "COMMIT".to_string(),
            ]
        );
        Ok(())
    }

    #[tokio::test]
    async fn migrate_failure_names_migration() -> Result<(), Box<dyn std::error::Error>> {
        let mut fake = Fake::default();
        fake.fail
            .push(("create table t()".to_string(), PgError::local("boom")));
        let err = migrate(&mut fake, &[pair("a/2.sql", "create table t()")])
            .await
            .err()
            .ok_or("expected an error")?;
        assert!(err.message.starts_with("Migration a/2.sql failed"));
        assert!(err.message.contains("boom"));
        assert!(fake.log.iter().any(|line| line == "ROLLBACK"));
        Ok(())
    }

    #[tokio::test]
    async fn query_as_runs_under_claims() -> Result<(), Box<dyn std::error::Error>> {
        let mut fake = Fake::default();
        let _ = query_as(&mut fake, "select 1", &[], None).await?;
        assert_eq!(
            fake.log,
            vec![
                "BEGIN".to_string(),
                r#"select set_config('request.jwt.claims', $1, true), set_config('role', 'authenticated', true) | ["{\"sub\":\"00000000-0000-4000-8000-000000000001\",\"role\":\"authenticated\"}"]"#.to_string(),
                "select 1 | []".to_string(),
                "COMMIT".to_string(),
            ]
        );
        Ok(())
    }

    #[tokio::test]
    async fn query_as_retries_aborted_transaction() -> Result<(), Box<dyn std::error::Error>> {
        let mut fake = Fake::default();
        fake.fail
            .push(("BEGIN".to_string(), pg_error("25P02", "aborted")));
        let rows = query_as(&mut fake, "select 1", &[], Some(Some("u1"))).await?;
        assert_eq!(rows, TextRows::default());
        assert_eq!(fake.log[0], "BEGIN");
        assert_eq!(fake.log[1], "ROLLBACK");
        assert_eq!(fake.log[2], "BEGIN");
        assert!(fake.log[3].starts_with(SET_CONFIG_SQL));
        assert_eq!(fake.log[4], "select 1 | []");
        assert_eq!(fake.log[5], "COMMIT");
        assert_eq!(fake.log.len(), 6);
        Ok(())
    }

    #[tokio::test]
    async fn query_as_other_error_does_not_retry() -> Result<(), Box<dyn std::error::Error>> {
        let mut fake = Fake::default();
        fake.fail
            .push(("select 1".to_string(), pg_error("42703", "no column")));
        let result = query_as(&mut fake, "select 1", &[], None).await;
        assert!(result.is_err());
        assert_eq!(
            fake.log
                .iter()
                .filter(|line| *line == "select 1 | []")
                .count(),
            1
        );
        assert_eq!(fake.log.last().map(String::as_str), Some("ROLLBACK"));
        Ok(())
    }

    #[tokio::test]
    async fn device_user_undefined_table_is_local() -> Result<(), Box<dyn std::error::Error>> {
        let mut fake = Fake::default();
        fake.fail.push((
            "select account_id from sync_state".to_string(),
            pg_error("42P01", "relation does not exist"),
        ));
        assert_eq!(device_user(&mut fake).await?, LOCAL_USER_ID);
        Ok(())
    }

    #[tokio::test]
    async fn device_user_reads_account() -> Result<(), Box<dyn std::error::Error>> {
        let mut fake = Fake::default();
        fake.rows.push((
            "select account_id from sync_state".to_string(),
            named(&["acc"]),
        ));
        assert_eq!(device_user(&mut fake).await?, "acc");
        Ok(())
    }

    #[tokio::test]
    async fn device_user_other_error_rolls_back() -> Result<(), Box<dyn std::error::Error>> {
        let mut fake = Fake::default();
        fake.fail.push((
            "select account_id from sync_state".to_string(),
            pg_error("XX000", "disk"),
        ));
        let result = device_user(&mut fake).await;
        assert!(result.is_err());
        assert!(fake.log.iter().any(|line| line == "ROLLBACK"));
        Ok(())
    }

    #[test]
    fn resets_device_user_matches_sync_tables() {
        assert!(resets_device_user(
            "UPDATE Sync_State set account_id = null"
        ));
        assert!(!resets_device_user("select 1"));
    }

    #[test]
    fn migration_files_sorted_sql_only() -> Result<(), Box<dyn std::error::Error>> {
        let base = format!("wf-local-db-test-{}", std::process::id());
        let dir = std::env::temp_dir().join(&base);
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir)?;
        std::fs::write(dir.join("b.sql"), "b")?;
        std::fs::write(dir.join("a.sql"), "a")?;
        std::fs::write(dir.join("x.txt"), "x")?;
        let files = migration_files(&[dir.as_path()]);
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(
            files?,
            vec![
                (format!("{base}/a.sql"), "a".to_string()),
                (format!("{base}/b.sql"), "b".to_string()),
            ]
        );
        Ok(())
    }
}
