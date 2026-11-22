//! Real-Postgres tests for the 0.9.7 export (T1-T3 of the plan). Each starts a throwaway
//! cluster with the app's migrations, seeds edge cases, and runs the export against an
//! in-memory workspace. They pass without running when `WF_REAL_PG_BIN` is unset.

use std::path::{Path, PathBuf};

use crate::local_pg::server::PgServer;
use crate::local_pg::wire::PgConn;
use crate::local_pg::{Conn, PgError, db};

/// Migrations the server runs but the local cluster never had.
const SERVER_ONLY: [&str; 2] = [
    "0161_files_first_server.sql",
    "0162_shared_docs_set_updated_at.sql",
];

fn repo() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// A migrated cluster for one test, or None when `WF_REAL_PG_BIN` is unset.
pub(super) async fn start(name: &str) -> Result<Option<(PgServer, PathBuf)>, PgError> {
    let Some(bin) = std::env::var_os("WF_REAL_PG_BIN").map(PathBuf::from) else {
        return Ok(None);
    };
    if let Some(exe) = std::env::var_os("WF_COMSPEC_SHIM_EXE") {
        crate::local_pg::comspec::enable(exe.into());
    }
    let root = std::env::temp_dir().join(format!("wf-m097-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    let server = PgServer::start(&bin, &root).await?;
    let mut conn = server.connect().await?;
    let shared = repo().join("db/migrations");
    let local = repo().join("db/migrations-local");
    let files = db::migration_files(&[&shared, &local])
        .map_err(|e| PgError::local(e.to_string()))?
        .into_iter()
        .filter(|(name, _)| !SERVER_ONLY.iter().any(|skip| name.ends_with(skip)))
        .collect::<Vec<_>>();
    let _ = db::migrate(&mut conn, &files).await?;
    db::ensure_local_user(&mut conn).await?;
    Ok(Some((server, root)))
}

pub(super) async fn finish(
    server: PgServer,
    root: PathBuf,
    result: Result<(), String>,
) -> Result<(), String> {
    let stopped = server.stop().await;
    let _ = std::fs::remove_dir_all(&root);
    result?;
    stopped.map_err(|e| e.message)
}

#[tokio::test]
#[ignore = "prints the schema of the exported tables; run by hand"]
async fn print_schema() -> Result<(), String> {
    let Some((server, root)) = start("schema").await.map_err(|e| e.message)? else {
        return Ok(());
    };
    let result = async {
        let mut conn: PgConn = server.connect().await.map_err(|e| e.message)?;
        let rows = conn
            .query(
                "select table_name, string_agg(column_name || ' ' || data_type || \
                 case when is_nullable = 'NO' then '!' else '' end || \
                 coalesce(' =' || column_default, ''), ', ' order by ordinal_position) \
                 from information_schema.columns where table_schema = 'public' \
                 group by table_name order by table_name",
                &[],
            )
            .await
            .map_err(|e| e.message)?;
        for row in rows.rows {
            println!(
                "{}: {}",
                row[0].clone().unwrap_or_default(),
                row[1].clone().unwrap_or_default()
            );
        }
        Ok(())
    }
    .await;
    finish(server, root, result).await
}
