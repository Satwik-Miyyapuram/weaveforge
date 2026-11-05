//! The local database as the app sees it, on native Postgres; ported from
//! `sidecar/src/local-db-host.ts` (step 5.3e).
//!
//! Opened on the first query, not at boot: somebody who never leaves the network never needs it.
//! One connection behind a lock, so two first queries wait on the same migration run. Queries run
//! as the device user under RLS; the user id never comes from the page.

use std::future::Future;
use std::path::PathBuf;
use std::pin::Pin;
use std::sync::{Arc, PoisonError};
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::Value;

use super::server::PgServer;
use super::wire::PgConn;
use super::{Conn, PgError, db, value};
use crate::commands::DbState;

const OPEN_FAILED: &str = "The local database could not be opened.";
const HEALTHY: &str = "The local database opened normally; there is nothing to reset.";
const BAD_QUERY: &str = "A query is a string of SQL and a list of plain values.";
const CLOSED: &str = "local database: closed";

/// Opens, closes and moves aside one database. [`PgEngine`] is the real one; tests use a fake.
pub trait Engine: Send + Sync {
    /// The connection queries run on.
    type Conn: Conn;
    /// What keeps the database running while it is open, such as the server process.
    type Handle: Send;

    /// Starts the database and connects to it.
    fn open(&self) -> impl Future<Output = Result<(Self::Conn, Self::Handle), PgError>> + Send;

    /// Closes the connection and stops the database; errors are dropped, since quitting goes on.
    fn close(&self, conn: Self::Conn, handle: Self::Handle) -> impl Future<Output = ()> + Send;

    /// Moves the data out of the way so the next open starts fresh. Never deletes.
    ///
    /// # Errors
    /// The move's error.
    fn discard(&self) -> Result<(), PgError>;

    /// Where the data lives, as `DbState.dataDir` reports it.
    fn data_dir(&self) -> String;
}

/// The real engine: a private Postgres server under `root`, from the binaries in `bin`.
pub struct PgEngine {
    /// The Postgres bin dir.
    pub bin: PathBuf,
    /// The folder holding `data/`, the password file and the server log.
    pub root: PathBuf,
}

impl Engine for PgEngine {
    type Conn = PgConn;
    type Handle = PgServer;

    async fn open(&self) -> Result<(PgConn, PgServer), PgError> {
        let server = PgServer::start(&self.bin, &self.root).await?;
        match server.connect().await {
            Ok(conn) => Ok((conn, server)),
            Err(err) => {
                let _ = server.stop().await;
                Err(err)
            }
        }
    }

    async fn close(&self, conn: PgConn, server: PgServer) {
        let _ = conn.close().await;
        let _ = server.stop().await;
    }

    fn discard(&self) -> Result<(), PgError> {
        if !self.root.exists() {
            return Ok(());
        }
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |d| d.as_millis());
        let name = self.root.file_name().map_or_else(
            || "local-pg".to_owned(),
            |n| n.to_string_lossy().into_owned(),
        );
        let aside = self
            .root
            .with_file_name(format!("{name}.discarded-{stamp}"));
        std::fs::rename(&self.root, aside)
            .map_err(|e| PgError::local(format!("could not move the database aside: {e}")))
    }

    fn data_dir(&self) -> String {
        self.root.join("data").to_string_lossy().into_owned()
    }
}

/// Takes a log line, such as a failed query's SQL.
pub type LogSink = Arc<dyn Fn(&str) + Send + Sync>;

/// What a [`FirstOpen`] job returns: a line to log, or nothing.
pub type FirstOpenFuture<'a> =
    Pin<Box<dyn Future<Output = Result<Option<String>, PgError>> + Send + 'a>>;

/// A job run on every open, on the migrated connection before any query, such as the one-time
/// copy of the old PGlite data. A failed job closes the database again, so the next query retries.
pub trait FirstOpen<C>: Send + Sync {
    /// Runs the job on `conn`; `Ok(Some(line))` is logged.
    fn run<'a>(&'a self, conn: &'a mut C) -> FirstOpenFuture<'a>;
}

/// An open database and what keeps it running.
struct Open<E: Engine> {
    conn: E::Conn,
    handle: E::Handle,
}

/// What the query lock guards.
struct Inner<E: Engine> {
    open: Option<Open<E>>,
    /// Who queries run as; re-read after a statement that may change it.
    user: Option<String>,
    /// Set by `close`; the app is quitting and the lock is about to go, so nothing reopens.
    closed: bool,
}

/// The local database: lazy open, queries as the device user, state and reset.
pub struct PgHost<E: Engine> {
    engine: E,
    migrations: Vec<PathBuf>,
    inner: tokio::sync::Mutex<Inner<E>>,
    /// The last open failure. Its own lock, so `state` never waits behind a slow query.
    failure: std::sync::Mutex<Option<String>>,
    log: Option<LogSink>,
    first_open: Option<Arc<dyn FirstOpen<E::Conn>>>,
}

/// Whether a param is a value the database takes: plain JSON or a tagged `$bigint` / `$bytes`.
fn plain(param: &Value) -> bool {
    match param {
        Value::Null | Value::Bool(_) | Value::Number(_) | Value::String(_) => true,
        Value::Object(map) => {
            map.len() == 1
                && (matches!(map.get("$bigint"), Some(Value::String(_)))
                    || matches!(map.get("$bytes"), Some(Value::String(_))))
        }
        Value::Array(_) => false,
    }
}

/// Migrates and adds the local user, on a freshly opened connection.
async fn prepare<C: Conn>(conn: &mut C, files: &[(String, String)]) -> Result<(), PgError> {
    let _ = db::migrate(conn, files).await?;
    db::ensure_local_user(conn).await
}

impl<E: Engine> PgHost<E> {
    /// A closed database; `migrations` are the `.sql` dirs, applied in this order.
    #[must_use]
    pub fn new(engine: E, migrations: Vec<PathBuf>) -> Self {
        Self {
            engine,
            migrations,
            inner: tokio::sync::Mutex::new(Inner {
                open: None,
                user: None,
                closed: false,
            }),
            failure: std::sync::Mutex::new(None),
            log: None,
            first_open: None,
        }
    }

    /// Runs `job` on each open, after the migrations and before any query.
    #[must_use]
    pub fn with_first_open(mut self, job: Arc<dyn FirstOpen<E::Conn>>) -> Self {
        self.first_open = Some(job);
        self
    }

    /// Sends failed-query lines to `sink` instead of stderr.
    #[must_use]
    pub fn with_log(mut self, sink: LogSink) -> Self {
        self.log = Some(sink);
        self
    }

    fn failure(&self) -> Option<String> {
        self.failure
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }

    fn set_failure(&self, failure: Option<String>) {
        *self.failure.lock().unwrap_or_else(PoisonError::into_inner) = failure;
    }

    fn log_line(&self, line: &str) {
        match &self.log {
            Some(log) => log(line),
            None => eprintln!("{line}"),
        }
    }

    /// Opens, migrates and adds the local user; closes again if any step fails.
    async fn open_db(&self) -> Result<Open<E>, PgError> {
        let dirs: Vec<&std::path::Path> = self.migrations.iter().map(PathBuf::as_path).collect();
        let files = db::migration_files(&dirs).map_err(|e| PgError::local(e.to_string()))?;
        let (mut conn, handle) = self.engine.open().await?;
        let ready = match prepare(&mut conn, &files).await {
            Ok(()) => self.run_first_open(&mut conn).await,
            Err(err) => Err(err),
        };
        match ready {
            Ok(()) => Ok(Open { conn, handle }),
            Err(err) => {
                self.engine.close(conn, handle).await;
                Err(err)
            }
        }
    }

    /// Runs the first-open job, if any, and logs its line.
    async fn run_first_open(&self, conn: &mut E::Conn) -> Result<(), PgError> {
        let Some(job) = &self.first_open else {
            return Ok(());
        };
        if let Some(line) = job.run(conn).await? {
            self.log_line(&line);
        }
        Ok(())
    }

    /// Runs one statement as the device user and returns the rows as JSON objects.
    ///
    /// # Errors
    /// A message for the page: a bad query, the open failure, or the statement's error.
    pub async fn query(&self, sql: &str, params: &[Value]) -> Result<Vec<Value>, String> {
        if sql.trim().is_empty() || !params.iter().all(plain) {
            return Err(BAD_QUERY.to_owned());
        }
        let mut inner = self.inner.lock().await;
        self.run(&mut inner, sql, params).await.map_err(|err| {
            // SQL only, never params: they can hold a person's text.
            let code = if err.code.is_empty() {
                String::new()
            } else {
                format!(" ({})", err.code)
            };
            let short: String = sql.split_whitespace().collect::<Vec<_>>().join(" ");
            let short: String = short.chars().take(200).collect();
            self.log_line(&format!(
                "[local-db] query failed{code}: {} | {short}",
                err.message
            ));
            err.message
        })
    }

    async fn run(
        &self,
        inner: &mut Inner<E>,
        sql: &str,
        params: &[Value],
    ) -> Result<Vec<Value>, PgError> {
        if inner.closed {
            return Err(PgError::local(CLOSED));
        }
        if inner.open.is_none() {
            match self.open_db().await {
                Ok(open) => {
                    inner.open = Some(open);
                    // A later open that works makes the database healthy, so reset is refused again.
                    self.set_failure(None);
                }
                Err(err) => {
                    let message = format!("{OPEN_FAILED} {}", err.message);
                    self.set_failure(Some(message.clone()));
                    return Err(PgError {
                        code: err.code,
                        message,
                    });
                }
            }
        }
        let Some(open) = inner.open.as_mut() else {
            return Err(PgError::local(OPEN_FAILED));
        };
        let result = match inner.user.take() {
            Some(user) => Ok(user),
            None => db::device_user(&mut open.conn).await,
        };
        let result = match result {
            Ok(user) => {
                let result = db::query_as(&mut open.conn, sql, params, Some(Some(&user))).await;
                if !(result.is_ok() && db::resets_device_user(sql)) {
                    inner.user = Some(user);
                }
                result
            }
            Err(err) => Err(err),
        };
        // A broken connection (Postgres crashed, socket gone) is dropped, so the next query reopens.
        if result.as_ref().is_err_and(PgError::is_connection)
            && let Some(open) = inner.open.take()
        {
            inner.user = None;
            self.engine.close(open.conn, open.handle).await;
        }
        Ok(value::rows_to_json(&result?))
    }

    /// The database's health, without opening it.
    pub fn state(&self) -> DbState {
        DbState {
            failure: self.failure(),
            data_dir: self.engine.data_dir(),
            restored_from: None,
        }
    }

    /// Moves an unopenable database aside, so the next query starts a new one.
    ///
    /// # Errors
    /// Refused unless an open failed, so a page cannot make working data vanish; or the move's
    /// error, which keeps the failure so the person can try again.
    pub async fn reset(&self) -> Result<(), String> {
        let mut inner = self.inner.lock().await;
        if inner.closed {
            return Err(CLOSED.to_owned());
        }
        if self.failure().is_none() {
            return Err(HEALTHY.to_owned());
        }
        if let Some(open) = inner.open.take() {
            self.engine.close(open.conn, open.handle).await;
        }
        inner.user = None;
        self.engine.discard().map_err(|e| e.message)?;
        self.set_failure(None);
        Ok(())
    }

    /// Closes the database if it was opened; quitting never starts one, and no later call reopens it.
    pub async fn close(&self) {
        let mut inner = self.inner.lock().await;
        inner.closed = true;
        inner.user = None;
        if let Some(open) = inner.open.take() {
            self.engine.close(open.conn, open.handle).await;
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;
    use std::sync::atomic::{AtomicUsize, Ordering};

    use serde_json::json;

    use super::super::TextRows;
    use super::*;

    /// Every statement the fake saw, shared with the test.
    type Seen = Arc<Mutex<Vec<String>>>;

    struct FakeConn {
        seen: Seen,
    }

    impl Conn for FakeConn {
        async fn exec(&mut self, sql: &str) -> Result<(), PgError> {
            self.seen
                .lock()
                .map_err(|_| PgError::local("poisoned"))?
                .push(sql.to_owned());
            Ok(())
        }

        async fn query(&mut self, sql: &str, _params: &[Value]) -> Result<TextRows, PgError> {
            self.seen
                .lock()
                .map_err(|_| PgError::local("poisoned"))?
                .push(sql.to_owned());
            if sql.contains("boom") {
                return Err(PgError {
                    code: "42601".to_owned(),
                    message: "syntax error".to_owned(),
                });
            }
            if sql.contains("lost") {
                return Err(PgError::connection("gone"));
            }
            Ok(TextRows::default())
        }
    }

    #[derive(Default)]
    struct FakeEngine {
        seen: Seen,
        opens: AtomicUsize,
        closes: AtomicUsize,
        discards: AtomicUsize,
        fail_opens: AtomicUsize,
    }

    impl Engine for Arc<FakeEngine> {
        type Conn = FakeConn;
        type Handle = ();

        async fn open(&self) -> Result<(FakeConn, ()), PgError> {
            let _ = self.opens.fetch_add(1, Ordering::SeqCst);
            if self.fail_opens.load(Ordering::SeqCst) > 0 {
                let _ = self.fail_opens.fetch_sub(1, Ordering::SeqCst);
                return Err(PgError::local("no server"));
            }
            Ok((
                FakeConn {
                    seen: Arc::clone(&self.seen),
                },
                (),
            ))
        }

        async fn close(&self, _conn: FakeConn, _handle: ()) {
            let _ = self.closes.fetch_add(1, Ordering::SeqCst);
        }

        fn discard(&self) -> Result<(), PgError> {
            let _ = self.discards.fetch_add(1, Ordering::SeqCst);
            Ok(())
        }

        fn data_dir(&self) -> String {
            "dir/data".to_owned()
        }
    }

    fn host() -> (Arc<FakeEngine>, PgHost<Arc<FakeEngine>>) {
        let engine = Arc::new(FakeEngine::default());
        let host = PgHost::new(Arc::clone(&engine), Vec::new()).with_log(Arc::new(|_| {}));
        (engine, host)
    }

    /// Counts its runs; fails while `fails` is above zero.
    #[derive(Default)]
    struct FakeJob {
        runs: AtomicUsize,
        fails: AtomicUsize,
    }

    impl FirstOpen<FakeConn> for FakeJob {
        fn run<'a>(&'a self, conn: &'a mut FakeConn) -> FirstOpenFuture<'a> {
            Box::pin(async move {
                let _ = self.runs.fetch_add(1, Ordering::SeqCst);
                conn.exec("job").await?;
                if self.fails.load(Ordering::SeqCst) > 0 {
                    let _ = self.fails.fetch_sub(1, Ordering::SeqCst);
                    return Err(PgError::local("copy failed"));
                }
                Ok(Some("copied".to_owned()))
            })
        }
    }

    #[tokio::test]
    async fn first_open_job_runs_before_queries_and_retries_after_failure() -> Result<(), String> {
        let job = Arc::new(FakeJob::default());
        job.fails.store(1, Ordering::SeqCst);
        let engine = Arc::new(FakeEngine::default());
        let logged: Seen = Arc::default();
        let sink = Arc::clone(&logged);
        let host = PgHost::new(Arc::clone(&engine), Vec::new())
            .with_log(Arc::new(move |line: &str| {
                if let Ok(mut lines) = sink.lock() {
                    lines.push(line.to_owned());
                }
            }))
            .with_first_open(Arc::clone(&job) as Arc<dyn FirstOpen<FakeConn>>);
        let err = host.query("select 1", &[]).await.err().unwrap_or_default();
        assert_eq!(err, format!("{OPEN_FAILED} copy failed"));
        assert_eq!(engine.closes.load(Ordering::SeqCst), 1);
        assert_eq!(count(&engine, "select 1"), 0);
        let _ = host.query("select 1", &[]).await?;
        let _ = host.query("select 2", &[]).await?;
        assert_eq!(job.runs.load(Ordering::SeqCst), 2);
        assert_eq!(engine.opens.load(Ordering::SeqCst), 2);
        let seen = engine.seen.lock().map(|s| s.clone()).unwrap_or_default();
        let job_at = seen.iter().rposition(|s| s == "job");
        let query_at = seen.iter().position(|s| s.contains("select 1"));
        assert!(job_at.is_some() && job_at < query_at);
        let lines = logged.lock().map(|l| l.clone()).unwrap_or_default();
        assert!(lines.contains(&"copied".to_owned()));
        Ok(())
    }

    fn count(engine: &FakeEngine, needle: &str) -> usize {
        engine
            .seen
            .lock()
            .map(|seen| seen.iter().filter(|s| s.contains(needle)).count())
            .unwrap_or(0)
    }

    #[tokio::test]
    async fn opens_and_migrates_once() -> Result<(), String> {
        let (engine, host) = host();
        let _ = host.query("select 1", &[]).await?;
        let _ = host
            .query("select 2", &[json!(1), json!({"$bigint": "9"})])
            .await?;
        assert_eq!(engine.opens.load(Ordering::SeqCst), 1);
        assert_eq!(count(&engine, "weaveforge_migrations ("), 1);
        assert_eq!(count(&engine, "insert into auth.users"), 1);
        assert_eq!(count(&engine, "select account_id"), 1);
        Ok(())
    }

    #[tokio::test]
    async fn bad_queries_are_refused_without_opening() {
        let (engine, host) = host();
        assert_eq!(host.query("  ", &[]).await, Err(BAD_QUERY.to_owned()));
        assert_eq!(
            host.query("select $1", &[json!([1])]).await,
            Err(BAD_QUERY.to_owned())
        );
        assert_eq!(
            host.query("select $1", &[json!({"a": 1})]).await,
            Err(BAD_QUERY.to_owned())
        );
        assert_eq!(engine.opens.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn failed_open_is_reported_and_retried() -> Result<(), String> {
        let (engine, host) = host();
        engine.fail_opens.store(1, Ordering::SeqCst);
        let err = host.query("select 1", &[]).await.err().unwrap_or_default();
        assert_eq!(err, format!("{OPEN_FAILED} no server"));
        assert_eq!(host.state().failure, Some(err));
        assert_eq!(host.state().data_dir, "dir/data");
        let _ = host.query("select 1", &[]).await?;
        assert_eq!(engine.opens.load(Ordering::SeqCst), 2);
        assert_eq!(host.state().failure, None);
        Ok(())
    }

    #[tokio::test]
    async fn reset_is_refused_when_healthy() -> Result<(), String> {
        let (engine, host) = host();
        assert_eq!(host.reset().await, Err(HEALTHY.to_owned()));
        let _ = host.query("select 1", &[]).await?;
        assert_eq!(host.reset().await, Err(HEALTHY.to_owned()));
        assert_eq!(engine.discards.load(Ordering::SeqCst), 0);
        Ok(())
    }

    #[tokio::test]
    async fn reset_after_failure_moves_data_aside() {
        let (engine, host) = host();
        engine.fail_opens.store(1, Ordering::SeqCst);
        let _ = host.query("select 1", &[]).await;
        assert_eq!(host.reset().await, Ok(()));
        assert_eq!(engine.discards.load(Ordering::SeqCst), 1);
        assert_eq!(host.state().failure, None);
    }

    #[tokio::test]
    async fn identity_statements_reread_the_user() -> Result<(), String> {
        let (engine, host) = host();
        let _ = host.query("update sync_state set x = 1", &[]).await?;
        let _ = host.query("select 1", &[]).await?;
        assert_eq!(count(&engine, "select account_id"), 2);
        let _ = host.query("select 2", &[]).await?;
        assert_eq!(count(&engine, "select account_id"), 2);
        Ok(())
    }

    #[tokio::test]
    async fn statement_errors_keep_the_database_open() {
        let (engine, host) = host();
        assert_eq!(
            host.query("boom", &[]).await,
            Err("syntax error".to_owned())
        );
        assert_eq!(host.state().failure, None);
        let _ = host.query("select 1", &[]).await;
        assert_eq!(engine.opens.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn connection_errors_reopen_on_next_query() -> Result<(), String> {
        let (engine, host) = host();
        assert_eq!(host.query("lost", &[]).await, Err("gone".to_owned()));
        assert_eq!(engine.closes.load(Ordering::SeqCst), 1);
        let _ = host.query("select 1", &[]).await?;
        assert_eq!(engine.opens.load(Ordering::SeqCst), 2);
        assert_eq!(count(&engine, "select account_id"), 2);
        Ok(())
    }

    #[tokio::test]
    async fn close_never_opens_and_closes_once() -> Result<(), String> {
        let (engine, host) = host();
        let _ = host.query("select 1", &[]).await?;
        host.close().await;
        host.close().await;
        assert_eq!(engine.closes.load(Ordering::SeqCst), 1);
        Ok(())
    }

    #[tokio::test]
    async fn closed_host_never_reopens() {
        let (engine, host) = host();
        host.close().await;
        assert_eq!(engine.closes.load(Ordering::SeqCst), 0);
        assert_eq!(host.query("select 1", &[]).await, Err(CLOSED.to_owned()));
        engine.fail_opens.store(1, Ordering::SeqCst);
        assert_eq!(host.reset().await, Err(CLOSED.to_owned()));
        assert_eq!(engine.opens.load(Ordering::SeqCst), 0);
        assert_eq!(engine.discards.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn discard_renames_and_never_deletes() -> Result<(), String> {
        let tmp = std::env::temp_dir().join(format!(
            "wf-host-discard-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_or(0, |d| d.as_nanos())
        ));
        let root = tmp.join("local-pg");
        std::fs::create_dir_all(root.join("data")).map_err(|e| e.to_string())?;
        std::fs::write(root.join("data").join("PG_VERSION"), "17").map_err(|e| e.to_string())?;
        let engine = PgEngine {
            bin: PathBuf::new(),
            root: root.clone(),
        };
        engine.discard().map_err(|e| e.message)?;
        assert!(!root.exists());
        let moved: Vec<_> = std::fs::read_dir(&tmp)
            .map_err(|e| e.to_string())?
            .filter_map(Result::ok)
            .filter(|e| {
                e.file_name()
                    .to_string_lossy()
                    .starts_with("local-pg.discarded-")
            })
            .collect();
        assert_eq!(moved.len(), 1);
        assert!(moved[0].path().join("data").join("PG_VERSION").is_file());
        // Nothing to move is not an error.
        engine.discard().map_err(|e| e.message)?;
        let _ = std::fs::remove_dir_all(&tmp);
        Ok(())
    }
}
