//! The pre-migration dump for the 0.9.7 export (`migrate097Backup`). No Postgres needed: the dump
//! step is a closure, so these tests check the file name, the never-overwrite rule and the cleanup.

use std::fs;
use std::path::{Path, PathBuf};

use weaveforge_shell_lib::migrate_097::backup::write_backup;

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
