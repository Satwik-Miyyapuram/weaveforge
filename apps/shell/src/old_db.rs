//! The old PGlite database, read once into the native one (step 5.3f).
//!
//! Native Postgres cannot open PGlite's files, so the Node sidecar runs only to copy them: it starts on
//! the copy's first read and stops when the copy job ends. Once the copy is recorded it never starts.

use std::sync::Arc;
use std::time::Duration;

use serde_json::{Value, json};

use crate::commands::ShellError;
use crate::local_pg::host::{FirstOpen, FirstOpenFuture};
use crate::sidecar::{Sidecar, SidecarConfig};

/// The sidecar that reads the old database, started on demand.
pub struct OldDb {
    config: SidecarConfig,
    sidecar: tokio::sync::Mutex<Option<Sidecar>>,
}

impl OldDb {
    /// An old database read by a sidecar spawned from `config`; nothing runs yet.
    #[must_use]
    pub fn new(config: SidecarConfig) -> Self {
        Self {
            config,
            sidecar: tokio::sync::Mutex::new(None),
        }
    }

    /// Runs `sql` on the old database through the sidecar's `exportRows`, starting it if needed.
    ///
    /// # Errors
    /// The sidecar could not start, the call failed, or the reply is not a list of rows.
    pub async fn rows(&self, sql: String) -> Result<Vec<Value>, String> {
        let mut sidecar = self.sidecar.lock().await;
        if sidecar.is_none() {
            let spawned = Sidecar::spawn(self.config.clone())
                .map_err(|e| format!("the old local database: {}", ShellError::from(e).message))?;
            *sidecar = Some(spawned);
        }
        let Some(running) = sidecar.as_ref() else {
            return Err("the old local database is not running".to_owned());
        };
        match running.call("exportRows", json!({ "sql": sql })).await {
            Ok(Value::Array(rows)) => Ok(rows),
            Ok(_) => Err("the old local database sent no rows".to_owned()),
            Err(e) => Err(ShellError::from(e).message),
        }
    }

    /// Whether the sidecar runs now.
    pub async fn running(&self) -> bool {
        self.sidecar.lock().await.is_some()
    }

    /// Stops the sidecar, waiting up to `grace`; the next `rows` starts it again.
    pub async fn stop(&self, grace: Duration) {
        let sidecar = self.sidecar.lock().await.take();
        if let Some(sidecar) = sidecar {
            let _ = sidecar.shutdown(grace).await;
        }
    }
}

/// Runs `job`, then stops the old database's sidecar, so it never idles after the copy.
pub struct StopAfter<J> {
    /// The copy job, such as a `local_pg::import::OnceImport`.
    pub job: J,
    /// The sidecar the job reads through.
    pub old: Arc<OldDb>,
}

impl<C: Send, J: FirstOpen<C>> FirstOpen<C> for StopAfter<J> {
    fn run<'a>(&'a self, conn: &'a mut C) -> FirstOpenFuture<'a> {
        Box::pin(async move {
            let result = self.job.run(conn).await;
            self.old.stop(crate::launch::SHUTDOWN_GRACE).await;
            result
        })
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;
    use crate::local_pg::PgError;

    fn config(extra: &[&str]) -> SidecarConfig {
        let fixture =
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/fake-sidecar.mjs");
        let mut args = vec![fixture.into_os_string()];
        args.extend(extra.iter().map(Into::into));
        SidecarConfig {
            program: "node".into(),
            args,
            cwd: None,
            call_timeout: Duration::from_secs(5),
            max_in_flight: 8,
            max_request_bytes: 4096,
            max_reply_bytes: 1 << 20,
        }
    }

    fn spawn_log(tag: &str) -> PathBuf {
        std::env::temp_dir().join(format!("wf-old-db-{tag}-{}.log", std::process::id()))
    }

    fn spawns(log: &PathBuf) -> usize {
        std::fs::read_to_string(log).map_or(0, |s| s.lines().count())
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn starts_on_the_first_read_and_again_after_a_stop() {
        let log = spawn_log("lazy");
        let _ = std::fs::remove_file(&log);
        let old = OldDb::new(config(&["--spawn-log", &log.to_string_lossy()]));
        assert!(!old.running().await);
        assert_eq!(spawns(&log), 0);
        let rows = old.rows("select 1".to_owned()).await;
        assert_eq!(rows, Ok(vec![json!({ "sql": "select 1" })]));
        let _ = old.rows("select 2".to_owned()).await;
        assert!(old.running().await);
        assert_eq!(spawns(&log), 1);
        old.stop(Duration::from_secs(5)).await;
        assert!(!old.running().await);
        let _ = old.rows("select 3".to_owned()).await;
        assert_eq!(spawns(&log), 2);
        old.stop(Duration::from_secs(5)).await;
        let _ = std::fs::remove_file(&log);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_reply_that_is_not_rows_is_an_error() {
        let old = OldDb::new(config(&[]));
        assert_eq!(
            old.rows("scalar".to_owned()).await,
            Err("the old local database sent no rows".to_owned())
        );
        assert_eq!(
            old.rows("fail".to_owned()).await,
            Err("relation missing".to_owned())
        );
        old.stop(Duration::from_secs(5)).await;
    }

    #[tokio::test]
    async fn a_failed_spawn_says_so() {
        let mut bad = config(&[]);
        bad.program = "wf-no-such-program".into();
        let old = OldDb::new(bad);
        let error = old.rows("select 1".to_owned()).await;
        assert!(
            error.as_ref().is_err_and(
                |e| e.starts_with("the old local database: local database failed to start")
            ),
            "{error:?}"
        );
        assert!(!old.running().await);
    }

    /// Reads once through the old database, then returns `result`.
    struct ReadsThen {
        old: Arc<OldDb>,
        result: Result<Option<String>, PgError>,
    }

    impl FirstOpen<()> for ReadsThen {
        fn run<'a>(&'a self, _conn: &'a mut ()) -> FirstOpenFuture<'a> {
            Box::pin(async move {
                let _ = self.old.rows("select 1".to_owned()).await;
                assert!(self.old.running().await);
                self.result.clone()
            })
        }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn the_sidecar_stops_after_the_job_whether_it_worked_or_not() {
        for result in [Ok(Some("copied".to_owned())), Err(PgError::local("broken"))] {
            let old = Arc::new(OldDb::new(config(&[])));
            let job = StopAfter {
                job: ReadsThen {
                    old: Arc::clone(&old),
                    result: result.clone(),
                },
                old: Arc::clone(&old),
            };
            let got = job.run(&mut ()).await;
            assert_eq!(got.map_err(|e| e.message), result.map_err(|e| e.message));
            assert!(!old.running().await);
        }
    }
}
