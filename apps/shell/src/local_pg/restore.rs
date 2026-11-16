//! Rebuilds a missing native database from its newest good backup (step 5.3e); ported from
//! `sidecar/src/local-db-restore.ts`.
//!
//! Each backup is tried newest first in its own scratch folder beside the root: a new cluster, the
//! roles a dump does not carry, `pg_restore`, a check query, a clean stop. The first that passes is
//! renamed into place. A scratch folder is ours, so a failed one is removed; the backups and any
//! old data are never deleted.

use std::future::Future;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use super::server::PgServer;
use super::{Conn, PgError, db};

/// `<root>.restore-<stamp>-<i>`: where backup `i` is tried.
fn scratch(root: &Path, stamp: u128, i: usize) -> PathBuf {
    let name = root.file_name().map_or_else(
        || "local-pg".to_owned(),
        |n| n.to_string_lossy().into_owned(),
    );
    root.with_file_name(format!("{name}.restore-{stamp}-{i}"))
}

/// Removes scratch folders an interrupted restore left beside `root`.
pub fn clear_leftovers(root: &Path) {
    let (Some(parent), Some(name)) = (root.parent(), root.file_name()) else {
        return;
    };
    let prefix = format!("{}.restore-", name.to_string_lossy());
    let Ok(entries) = std::fs::read_dir(parent) else {
        return;
    };
    for entry in entries.flatten() {
        if entry.file_name().to_string_lossy().starts_with(&prefix) {
            let _ = std::fs::remove_dir_all(entry.path());
        }
    }
}

/// Tries `dumps` in order, loading each into a scratch folder with `load`; the first that loads is
/// renamed to `root` and returned. `None` when there were none or every one failed.
///
/// # Errors
/// `root` already exists (a restore never replaces data), or the rename into place failed.
pub async fn restore_newest_good<F, Fut>(
    root: &Path,
    dumps: &[PathBuf],
    load: F,
) -> Result<Option<PathBuf>, PgError>
where
    F: Fn(PathBuf, PathBuf) -> Fut,
    Fut: Future<Output = Result<(), PgError>>,
{
    if root.exists() {
        return Err(PgError::local(format!(
            "refusing to restore over {}",
            root.display()
        )));
    }
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis());
    for (i, dump) in dumps.iter().enumerate() {
        let dir = scratch(root, stamp, i);
        if load(dir.clone(), dump.clone()).await.is_ok() {
            std::fs::rename(&dir, root).map_err(|e| {
                PgError::local(format!("could not move the restored database in: {e}"))
            })?;
            return Ok(Some(dump.clone()));
        }
        let _ = std::fs::remove_dir_all(&dir);
    }
    Ok(None)
}

/// Loads `dump` into a new cluster under `dir` and checks it answers; the server is stopped either way.
///
/// # Errors
/// Any step's error: initdb, start, the roles, `pg_restore`, or the check query.
pub async fn load_dump(bin: &Path, dir: &Path, dump: &Path) -> Result<(), PgError> {
    let server = PgServer::start(bin, dir).await?;
    let result = load_into(&server, dump).await;
    let stopped = server.stop().await;
    result.and(stopped)
}

async fn load_into(server: &PgServer, dump: &Path) -> Result<(), PgError> {
    let mut conn = server.connect().await?;
    let roles = conn.exec(db::ROLES_SQL).await;
    let _ = conn.close().await;
    roles?;
    server.restore(dump).await?;
    let mut conn = server.connect().await?;
    let check = conn
        .query("select count(*) from weaveforge_migrations", &[])
        .await
        .map(|_| ());
    let _ = conn.close().await;
    check
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;

    use super::*;

    fn temp(tag: &str) -> PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |d| d.as_nanos());
        std::env::temp_dir().join(format!("wf-restore-{tag}-{}-{stamp}", std::process::id()))
    }

    fn io(e: &std::io::Error) -> PgError {
        PgError::local(e.to_string())
    }

    #[tokio::test]
    async fn the_first_dump_that_loads_wins_and_failed_scratch_goes() -> Result<(), PgError> {
        let tmp = temp("wins");
        let root = tmp.join("local-pg");
        std::fs::create_dir_all(&tmp).map_err(|e| io(&e))?;
        let dumps = [
            tmp.join("new.dump"),
            tmp.join("mid.dump"),
            tmp.join("old.dump"),
        ];
        let tried = RefCell::new(Vec::new());
        let got = restore_newest_good(&root, &dumps, |dir, dump| {
            tried.borrow_mut().push(dump.clone());
            async move {
                std::fs::create_dir_all(dir.join("data")).map_err(|e| io(&e))?;
                if dump.ends_with("new.dump") {
                    return Err(PgError::local("pg_restore failed: bad"));
                }
                std::fs::write(
                    dir.join("data").join("from"),
                    dump.to_string_lossy().as_bytes(),
                )
                .map_err(|e| io(&e))
            }
        })
        .await?;
        assert_eq!(got, Some(dumps[1].clone()));
        assert_eq!(*tried.borrow(), dumps[..2]);
        let from = std::fs::read_to_string(root.join("data").join("from")).map_err(|e| io(&e))?;
        assert!(from.ends_with("mid.dump"));
        // Only the root is left: the failed scratch folder is gone.
        let names: Vec<String> = std::fs::read_dir(&tmp)
            .map_err(|e| io(&e))?
            .filter_map(|e| e.ok()?.file_name().into_string().ok())
            .filter(|n| n.starts_with("local-pg"))
            .collect();
        assert_eq!(names, ["local-pg"]);
        let _ = std::fs::remove_dir_all(&tmp);
        Ok(())
    }

    #[tokio::test]
    async fn none_when_every_dump_fails_or_there_are_none() -> Result<(), PgError> {
        let tmp = temp("none");
        let root = tmp.join("local-pg");
        std::fs::create_dir_all(&tmp).map_err(|e| io(&e))?;
        let fail = |_dir: PathBuf, _dump: PathBuf| async { Err(PgError::local("broken")) };
        assert_eq!(restore_newest_good(&root, &[], fail).await?, None);
        let dumps = [tmp.join("a.dump")];
        assert_eq!(restore_newest_good(&root, &dumps, fail).await?, None);
        assert!(!root.exists());
        let _ = std::fs::remove_dir_all(&tmp);
        Ok(())
    }

    #[tokio::test]
    async fn never_restores_over_existing_data() -> Result<(), PgError> {
        let tmp = temp("over");
        let root = tmp.join("local-pg");
        std::fs::create_dir_all(root.join("data")).map_err(|e| io(&e))?;
        let ok = |_dir: PathBuf, _dump: PathBuf| async { Ok(()) };
        let got = restore_newest_good(&root, &[tmp.join("a.dump")], ok).await;
        assert!(got.is_err_and(|e| e.message.starts_with("refusing to restore over")));
        assert!(root.join("data").is_dir());
        let _ = std::fs::remove_dir_all(&tmp);
        Ok(())
    }

    /// Real Postgres (`WF_REAL_PG_BIN`, and `WF_COMSPEC_SHIM_EXE` if cmd has an AutoRun): the app's
    /// scaffolding, a table granted to a role and a row survive dump, restore into a new root, start.
    #[tokio::test]
    async fn real_dump_restores_into_a_new_root() -> Result<(), PgError> {
        let Some(bin) = std::env::var_os("WF_REAL_PG_BIN").map(PathBuf::from) else {
            return Ok(());
        };
        if let Some(exe) = std::env::var_os("WF_COMSPEC_SHIM_EXE") {
            super::super::comspec::enable(exe.into());
        }
        let tmp = temp("real");
        let result = real_round_trip(&bin, &tmp).await;
        let _ = std::fs::remove_dir_all(&tmp);
        assert_eq!(result?, "1");
        Ok(())
    }

    async fn real_round_trip(bin: &Path, tmp: &Path) -> Result<String, PgError> {
        let dump = tmp.join("local-pg-x.dump");
        let server = PgServer::start(bin, &tmp.join("old")).await?;
        let mut conn = server.connect().await?;
        let made = async {
            conn.exec(db::LOCAL_BOOTSTRAP_SQL).await?;
            conn.exec(db::LEDGER_SQL).await?;
            conn.exec(
                "insert into weaveforge_migrations (name) values ('0001');
                 create table notes (id int primary key, body text);
                 alter table notes enable row level security;
                 grant select on notes to authenticated;
                 insert into notes values (1, 'kept');
                 select digest('loads pgcrypto', 'sha256');",
            )
            .await?;
            server.dump(&dump).await
        }
        .await;
        let _ = conn.close().await;
        let _ = server.stop().await;
        made?;

        let root = tmp.join("local-pg");
        let from =
            restore_newest_good(&root, std::slice::from_ref(&dump), |dir, dump| async move {
                load_dump(bin, &dir, &dump).await
            })
            .await?;
        assert_eq!(from, Some(dump));
        let server = PgServer::start(bin, &root).await?;
        let mut conn = server.connect().await?;
        let rows = conn
            .query("select count(*) from notes where body = 'kept'", &[])
            .await;
        let _ = conn.close().await;
        let _ = server.stop().await;
        let rows = rows?;
        Ok(rows
            .rows
            .first()
            .and_then(|r| r.first().cloned().flatten())
            .unwrap_or_default())
    }

    #[test]
    fn leftovers_beside_the_root_are_cleared_and_nothing_else() -> Result<(), PgError> {
        let tmp = temp("left");
        let root = tmp.join("local-pg");
        for dir in ["local-pg.restore-1-0", "local-pg.discarded-5", "local-pg"] {
            std::fs::create_dir_all(tmp.join(dir)).map_err(|e| io(&e))?;
        }
        clear_leftovers(&root);
        assert!(!tmp.join("local-pg.restore-1-0").exists());
        assert!(tmp.join("local-pg.discarded-5").is_dir());
        assert!(root.is_dir());
        let _ = std::fs::remove_dir_all(&tmp);
        Ok(())
    }
}
