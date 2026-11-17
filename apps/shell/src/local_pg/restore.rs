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

/// The dump a restore rebuilt `root` from, and whether that database holds user rows. A restore
/// with `has_data` false is an empty database: the caller must not treat its dump as a good backup.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Restored {
    pub dump: PathBuf,
    pub has_data: bool,
}

/// Tries `dumps` newest first, loading each into a scratch folder with `load`, which returns whether
/// the loaded database holds user data. The first with data is renamed to `root` and returned. A
/// newest dump that is empty never wins over an older one with data: when no dump has data, the
/// newest that loaded is restored with `has_data` false. `None` when none loaded.
///
/// # Errors
/// `root` already exists (a restore never replaces data), or the rename into place failed.
pub async fn restore_newest_good<F, Fut>(
    root: &Path,
    dumps: &[PathBuf],
    load: F,
) -> Result<Option<Restored>, PgError>
where
    F: Fn(PathBuf, PathBuf) -> Fut,
    Fut: Future<Output = Result<bool, PgError>>,
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
    // The newest dump that loaded but held no user data, kept only while no later one has data.
    let mut empty: Option<(PathBuf, PathBuf)> = None;
    for (i, dump) in dumps.iter().enumerate() {
        let dir = scratch(root, stamp, i);
        match load(dir.clone(), dump.clone()).await {
            Ok(true) => {
                if let Some((spare, _)) = empty.take() {
                    let _ = std::fs::remove_dir_all(&spare);
                }
                move_into(&dir, root)?;
                return Ok(Some(Restored {
                    dump: dump.clone(),
                    has_data: true,
                }));
            }
            Ok(false) if empty.is_none() => empty = Some((dir, dump.clone())),
            _ => {
                let _ = std::fs::remove_dir_all(&dir);
            }
        }
    }
    match empty {
        Some((dir, dump)) => {
            move_into(&dir, root)?;
            Ok(Some(Restored {
                dump,
                has_data: false,
            }))
        }
        None => Ok(None),
    }
}

fn move_into(dir: &Path, root: &Path) -> Result<(), PgError> {
    std::fs::rename(dir, root)
        .map_err(|e| PgError::local(format!("could not move the restored database in: {e}")))
}

/// Rows in the public tables other than the migrations ledger: a dump of an emptied database must
/// not count as the user's data.
const USER_ROWS_SQL: &str = "select coalesce(sum(n), 0)::text from (select (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', n.nspname, c.relname), false, true, '')))[1]::text::bigint as n from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and c.relname <> 'weaveforge_migrations') t";

/// Loads `dump` into a new cluster under `dir` and checks it answers; the server is stopped either way.
/// Returns whether the database holds user rows.
///
/// # Errors
/// Any step's error: initdb, start, the roles, `pg_restore`, or the check queries.
pub async fn load_dump(bin: &Path, dir: &Path, dump: &Path) -> Result<bool, PgError> {
    let server = PgServer::start(bin, dir).await?;
    let result = load_into(&server, dump).await;
    let stopped = server.stop().await;
    let has_data = result?;
    stopped.map(|()| has_data)
}

async fn load_into(server: &PgServer, dump: &Path) -> Result<bool, PgError> {
    let mut conn = server.connect().await?;
    let roles = conn.exec(db::ROLES_SQL).await;
    let _ = conn.close().await;
    roles?;
    server.restore(dump).await?;
    let mut conn = server.connect().await?;
    let check = conn
        .query("select count(*) from weaveforge_migrations", &[])
        .await;
    let rows = match check {
        Ok(_) => conn.query(USER_ROWS_SQL, &[]).await,
        Err(err) => Err(err),
    };
    let _ = conn.close().await;
    let rows = rows?;
    let count = rows
        .rows
        .first()
        .and_then(|r| r.first().cloned().flatten())
        .unwrap_or_default();
    Ok(count.parse::<i64>().unwrap_or(0) > 0)
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
                .map_err(|e| io(&e))?;
                Ok(true)
            }
        })
        .await?;
        let got = got.ok_or_else(|| PgError::local("nothing restored"))?;
        assert_eq!(got.dump, dumps[1]);
        assert!(got.has_data);
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
        assert!(restore_newest_good(&root, &[], fail).await?.is_none());
        let dumps = [tmp.join("a.dump")];
        assert!(restore_newest_good(&root, &dumps, fail).await?.is_none());
        assert!(!root.exists());
        let _ = std::fs::remove_dir_all(&tmp);
        Ok(())
    }

    #[tokio::test]
    async fn never_restores_over_existing_data() -> Result<(), PgError> {
        let tmp = temp("over");
        let root = tmp.join("local-pg");
        std::fs::create_dir_all(root.join("data")).map_err(|e| io(&e))?;
        let ok = |_dir: PathBuf, _dump: PathBuf| async { Ok(true) };
        let got = restore_newest_good(&root, &[tmp.join("a.dump")], ok).await;
        assert!(got.is_err_and(|e| e.message.starts_with("refusing to restore over")));
        assert!(root.join("data").is_dir());
        let _ = std::fs::remove_dir_all(&tmp);
        Ok(())
    }

    #[tokio::test]
    async fn an_empty_newest_dump_yields_to_an_older_one_with_data() -> Result<(), PgError> {
        let tmp = temp("empty-newest");
        let root = tmp.join("local-pg");
        std::fs::create_dir_all(&tmp).map_err(|e| io(&e))?;
        let dumps = [tmp.join("new.dump"), tmp.join("old.dump")];
        let got = restore_newest_good(&root, &dumps, |dir, dump| async move {
            std::fs::create_dir_all(dir.join("data")).map_err(|e| io(&e))?;
            std::fs::write(
                dir.join("data").join("from"),
                dump.to_string_lossy().as_bytes(),
            )
            .map_err(|e| io(&e))?;
            Ok(dump.ends_with("old.dump"))
        })
        .await?;
        let got = got.ok_or_else(|| PgError::local("nothing restored"))?;
        assert_eq!(got.dump, dumps[1]);
        assert!(got.has_data);
        let from = std::fs::read_to_string(root.join("data").join("from")).map_err(|e| io(&e))?;
        assert!(from.ends_with("old.dump"));
        let _ = std::fs::remove_dir_all(&tmp);
        Ok(())
    }

    #[tokio::test]
    async fn when_no_dump_has_data_the_newest_loaded_one_is_kept() -> Result<(), PgError> {
        let tmp = temp("all-empty");
        let root = tmp.join("local-pg");
        std::fs::create_dir_all(&tmp).map_err(|e| io(&e))?;
        let dumps = [tmp.join("new.dump"), tmp.join("old.dump")];
        let got = restore_newest_good(&root, &dumps, |dir, _dump| async move {
            std::fs::create_dir_all(dir.join("data")).map_err(|e| io(&e))?;
            Ok(false)
        })
        .await?;
        let got = got.ok_or_else(|| PgError::local("nothing restored"))?;
        assert_eq!(got.dump, dumps[0]);
        assert!(!got.has_data);
        assert!(root.join("data").is_dir());
        let names: Vec<String> = std::fs::read_dir(&tmp)
            .map_err(|e| io(&e))?
            .filter_map(|e| e.ok()?.file_name().into_string().ok())
            .filter(|n| n.starts_with("local-pg"))
            .collect();
        assert_eq!(names, ["local-pg"]);
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
        let from = from.ok_or_else(|| PgError::local("nothing restored"))?;
        assert_eq!(from.dump, dump);
        assert!(from.has_data);
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
