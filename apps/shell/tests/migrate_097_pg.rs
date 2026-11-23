//! Real-Postgres harness for the 0.9.7 export (plan §6). Starts a throwaway cluster with the
//! app's local migrations, loads the 0.9.4 fixture, and checks what the export will read.
//! Skips (passes without running) when `WF_REAL_PG_BIN` is unset.

use std::path::{Path, PathBuf};

use weaveforge_shell_lib::local_pg::server::PgServer;
use weaveforge_shell_lib::migrate_097::counts::count_rows;
use weaveforge_shell_lib::local_pg::{Conn, PgError, db};

/// Migrations the server runs but the local cluster never had.
const SERVER_ONLY: [&str; 2] = [
    "0161_files_first_server.sql",
    "0162_shared_docs_set_updated_at.sql",
];

fn repo() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn fixture() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/db-0.9.4.sql")
}

/// A migrated cluster for one test, or None when `WF_REAL_PG_BIN` is unset.
async fn start(name: &str) -> Result<Option<(PgServer, PathBuf)>, PgError> {
    let Some(bin) = std::env::var_os("WF_REAL_PG_BIN").map(PathBuf::from) else {
        return Ok(None);
    };
    if let Some(exe) = std::env::var_os("WF_COMSPEC_SHIM_EXE") {
        weaveforge_shell_lib::local_pg::comspec::enable(exe.into());
    }
    let root = std::env::temp_dir().join(format!("wf-m097-pg-{name}-{}", std::process::id()));
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

async fn finish(server: PgServer, root: PathBuf, result: Result<(), String>) -> Result<(), String> {
    let stopped = server.stop().await;
    let _ = std::fs::remove_dir_all(&root);
    result?;
    stopped.map_err(|e| e.message)
}

#[tokio::test]
async fn fixture_loads_into_0_9_4_schema() -> Result<(), String> {
    let Some((server, root)) = start("fixture").await.map_err(|e| e.message)? else {
        return Ok(());
    };
    let result = async {
        let mut conn = server.connect().await.map_err(|e| e.message)?;
        let sql = std::fs::read_to_string(fixture()).map_err(|e| e.to_string())?;
        conn.exec(&sql).await.map_err(|e| e.message)?;

        let ink = conn
            .query(
                "select count(*)::text from public.local_blobs \
                 where bucket = 'vault-assets' and path like '%/ink/%.inkb'",
                &[],
            )
            .await
            .map_err(|e| e.message)?;
        assert_eq!(ink.rows[0][0].as_deref(), Some("1"), "one ink chunk in vault-assets");

        let points = conn
            .query("select count(*)::text from public.experiment_metric_points", &[])
            .await
            .map_err(|e| e.message)?;
        assert_eq!(points.rows[0][0].as_deref(), Some("3"), "three metric points");

        let notes = conn
            .query("select count(*)::text from public.vault_pages", &[])
            .await
            .map_err(|e| e.message)?;
        assert_eq!(notes.rows[0][0].as_deref(), Some("3"), "three notes: two in the first project, one in the second");
        Ok(())
    }
    .await;
    finish(server, root, result).await
}

async fn scalar(conn: &mut impl Conn, sql: &str) -> Result<u64, String> {
    let rows = conn.query(sql, &[]).await.map_err(|e| e.message)?;
    let cell = rows.rows.first().and_then(|row| row.first()).cloned().flatten();
    cell.ok_or_else(|| format!("no value: {sql}"))?
        .parse()
        .map_err(|e| format!("not a count: {e}"))
}

#[tokio::test]
async fn counts_cover_personal_tables_soft_deletes_and_crdt_tail() -> Result<(), String> {
    let Some((server, root)) = start("counts").await.map_err(|e| e.message)? else {
        return Ok(());
    };
    let result = async {
        let mut conn = server.connect().await.map_err(|e| e.message)?;
        let sql = std::fs::read_to_string(fixture()).map_err(|e| e.to_string())?;
        conn.exec(&sql).await.map_err(|e| e.message)?;

        // Soft-delete one tag when the column exists, so the count must skip it.
        let tags = scalar(&mut conn, "select count(*)::text from public.tags").await?;
        assert!(tags >= 1, "fixture has tags");
        let has_deleted_at = scalar(
            &mut conn,
            "select count(*)::text from information_schema.columns \
             where table_schema = 'public' and table_name = 'tags' and column_name = 'deleted_at'",
        )
        .await?;
        let soft = has_deleted_at == 1;
        if soft {
            conn.exec("update public.tags set deleted_at = now() where id = (select id from public.tags order by id limit 1)")
                .await
                .map_err(|e| e.message)?;
        }

        // Two CRDT updates on note 1001; its snapshot covers the first, so the tail is one.
        conn.exec(
            r#"
insert into public.crdt_updates (resource_type, resource_id, project_id, epoch, payload, author_id) values
  ('vault_page', '00000000-0000-4000-8000-000000001001', '00000000-0000-4000-8000-000000000100', 1, '\x00'::bytea, '00000000-0000-4000-8000-000000000001'),
  ('vault_page', '00000000-0000-4000-8000-000000001001', '00000000-0000-4000-8000-000000000100', 1, '\x01'::bytea, '00000000-0000-4000-8000-000000000001');
update public.vault_pages set snapshot_upto = (select min(id) from public.crdt_updates where resource_id = '00000000-0000-4000-8000-000000001001')
  where id = '00000000-0000-4000-8000-000000001001';
"#,
        )
        .await
        .map_err(|e| e.message)?;

        let counts = count_rows(&mut conn).await.map_err(|e| e.message)?;
        assert_eq!(
            counts.counts["tags"],
            u32::try_from(tags - u64::from(soft)).expect("tag count fits u32"),
            "soft-deleted tag is not counted"
        );
        assert_eq!(counts.counts["vault_pages"], 3, "three notes");
        assert_eq!(counts.counts["experiment_metric_chunks"], 1, "one chunk");
        assert_eq!(counts.counts["experiment_metric_points"], 3, "three points");
        assert_eq!(counts.crdt_tail["vault_page"], 1, "one update past the snapshot");
        assert_eq!(counts.crdt_tail["report_section"], 0, "no report-section updates");
        assert_eq!(counts.crdt_tail["log_entry"], 0, "no log-entry updates");
        Ok(())
    }
    .await;
    finish(server, root, result).await
}
