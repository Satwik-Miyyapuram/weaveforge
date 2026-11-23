//! The pre-migration dump for the 0.9.7 export (`migrate097Backup`). No Postgres needed: the dump
//! step is a closure, so these tests check the file name, the never-overwrite rule and the cleanup.

use std::fs;
use std::path::{Path, PathBuf};

use weaveforge_shell_lib::local_pg::backup::list;
use weaveforge_shell_lib::migrate_097::backup::write_backup;
use weaveforge_shell_lib::migrate_097::cmd::keep_migration_copy;

const DIR: &str = ".weaveforge/migration-0.9.7";
const STAMP: &str = "20261122T100000Z";

fn folder(name: &str) -> PathBuf {
    let base = std::env::temp_dir().join(format!("wf-m097-backup-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&base);
    fs::create_dir_all(&base).unwrap();
    base
}

#[test]
fn writes_a_timestamped_dump_and_returns_the_device_id() {
    let f = folder("writes");
    let mut dumped: Vec<PathBuf> = Vec::new();
    let out = write_backup(&f, "dev-a", STAMP, &mut |path: &Path| {
        dumped.push(path.to_path_buf());
        fs::write(path, b"PGDMP-bytes").map_err(|e| e.to_string())
    })
    .unwrap();
    assert_eq!(out.device_id, "dev-a");
    assert_eq!(out.dump, format!("pre-migration-{STAMP}.dump"));
    let path = f.join(DIR).join(&out.dump);
    assert_eq!(dumped, vec![path.clone()]);
    assert_eq!(fs::read(&path).unwrap(), b"PGDMP-bytes");
}

#[test]
fn never_overwrites_an_existing_dump() {
    let f = folder("keep");
    let dir = f.join(DIR);
    fs::create_dir_all(&dir).unwrap();
    let name = format!("pre-migration-{STAMP}.dump");
    fs::write(dir.join(&name), b"old").unwrap();
    let mut calls = 0;
    let err = write_backup(&f, "dev-a", STAMP, &mut |_p: &Path| {
        calls += 1;
        Ok(())
    })
    .unwrap_err();
    assert!(err.contains("already exists"), "{err}");
    assert_eq!(calls, 0, "the dump step never runs over an existing file");
    assert_eq!(fs::read(dir.join(&name)).unwrap(), b"old");
}

#[test]
fn a_failed_dump_leaves_no_file_and_says_why() {
    let f = folder("fail");
    let err = write_backup(&f, "dev-a", STAMP, &mut |p: &Path| {
        fs::write(p, b"partial").map_err(|e| e.to_string())?;
        Err("pg_dump failed: boom".to_owned())
    })
    .unwrap_err();
    assert!(err.contains("pg_dump failed: boom"), "{err}");
    assert!(
        !f.join(DIR)
            .join(format!("pre-migration-{STAMP}.dump"))
            .exists()
    );
}

#[test]
fn rejects_a_stamp_that_is_not_a_plain_name_part() {
    let f = folder("stamp");
    let err = write_backup(&f, "dev-a", "../escape", &mut |_p: &Path| Ok(())).unwrap_err();
    assert!(err.contains("stamp"), "{err}");
    assert!(!f.join("escape.dump").exists());
}

#[test]
fn the_migration_copy_is_outside_the_rotation_and_outlives_it() {
    let f = folder("copy");
    let rotation = f.join("local-db-backups");
    fs::create_dir_all(&rotation).unwrap();
    let source = rotation.join("local-pg-2026-11-23T01-02-03-004.dump");
    fs::write(&source, b"PGDMP-rows").unwrap();
    let out = keep_migration_copy(&f, "dev-a", &source).unwrap();
    assert_eq!(out.dump, "pre-migration-2026-11-23T01-02-03-004.dump");
    let dir = f.join(DIR);
    // Prune only ever removes what `list` returns; the migration copy is never listed.
    assert!(list(&dir).is_empty());
    // Removing the old data deletes the rotation; the copy report.json names stays.
    fs::remove_dir_all(&rotation).unwrap();
    assert_eq!(fs::read(dir.join(&out.dump)).unwrap(), b"PGDMP-rows");
}

#[test]
fn the_migration_copy_refuses_a_file_that_is_not_a_rotation_dump() {
    let f = folder("notrot");
    let source = f.join("other.dump");
    fs::write(&source, b"x").unwrap();
    let err = keep_migration_copy(&f, "dev-a", &source).unwrap_err();
    assert!(err.contains("not a rotation dump"), "{err}");
    assert!(!f.join(DIR).exists());
}
