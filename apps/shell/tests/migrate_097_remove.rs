//! Filesystem tests for "Remove old data" (0.9.7). No Postgres needed: the cluster is a plain
//! directory and the stop hook is a closure that records when it ran.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use weaveforge_shell_lib::migrate_097::remove::{
    old_db_removed, record_exported_to, remove_old_data,
};

const DIR: &str = ".weaveforge/migration-0.9.7";
const BACKUP: &str = ".weaveforge/migration-0.9.7/pre-migration.dump";
const BACKUP_NAME: &str = "pre-migration.dump";
const REPORT: &str = ".weaveforge/migration-0.9.7/report.json";
const SECRETS: &str = ".weaveforge/migration-0.9.7/secrets-moved-dev-a.json";
const NOW: &str = "2026-11-23T08:00:00Z";
/// The device id this machine reports (`device_id::get_or_create` in the real command).
const DEVICE: &str = "dev-a";

/// One run exactly as the TS web writer emits it (`run-web-export.ts`), with `missing` inside it.
const RUN_CLEAN: &str = r#"{"startedAt":"2026-11-23T07:59:00Z","finishedAt":"2026-11-23T08:00:00Z","state":"verified","sources":[],"kinds":{"notes":{"db":1,"files":1}},"blobs":{"db":0,"verified":0},"deviceId":"dev-a","missing":[]}"#;

fn run_missing(missing: &str) -> String {
    format!(r#"{{"startedAt":"{NOW}","finishedAt":"{NOW}","state":"verified","sources":[],"kinds":{{"notes":{{"db":1,"files":1}}}},"blobs":{{"db":0,"verified":0}},"deviceId":"dev-a","missing":[{missing}]}}"#)
}

fn secrets_json(count: u64) -> String {
    format!(r#"{{"movedAt":"{NOW}","count":{count},"deviceId":"{DEVICE}"}}"#)
}

/// A dump that passes the header check: PGDMP, archive version 1.16, int size 4, offset size 8,
/// format 1 (custom), padded past the 256-byte minimum.
fn good_dump() -> Vec<u8> {
    let mut bytes = b"PGDMP".to_vec();
    bytes.extend_from_slice(&[1, 16, 0, 4, 8, 1]);
    bytes.resize(4096, 0);
    bytes
}

/// A fresh folder with report.json (state `state`), the backup (if given), an exported-to.json
/// that names the folder, a cluster dir with data, and a sibling file that must survive.
struct Fixture {
    base: PathBuf,
    folder: PathBuf,
    pg_root: PathBuf,
}

impl Fixture {
    fn new(name: &str, state: Option<&str>, backup: Option<&[u8]>) -> Self {
        let base =
            std::env::temp_dir().join(format!("wf-m097-remove-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        let folder = base.join("vault");
        let pg_root = base.join("local-pg");
        fs::create_dir_all(folder.join(".weaveforge/migration-0.9.7")).unwrap();
        fs::create_dir_all(pg_root.join("data")).unwrap();
        fs::write(pg_root.join("data/PG_VERSION"), "16").unwrap();
        fs::create_dir_all(base.join("local-db-backups")).unwrap();
        fs::write(base.join("local-db-backups/keep.dump"), "old backup").unwrap();
        fs::write(folder.join("note.md"), "user note").unwrap();
        if let Some(state) = state {
            let report = format!(
                r#"{{"version":1,"state":"{state}","backup":"{BACKUP_NAME}","verifiedAt":"{NOW}","runs":[{RUN_CLEAN}]}}"#
            );
            fs::write(folder.join(REPORT), report).unwrap();
        }
        if let Some(bytes) = backup {
            fs::write(folder.join(BACKUP), bytes).unwrap();
        }
        fs::write(folder.join(SECRETS), secrets_json(0)).unwrap();
        let f = Self {
            base,
            folder,
            pg_root,
        };
        f.write_exported_to(&f.folder.clone());
        f
    }

    fn write_exported_to(&self, folder: &Path) {
        let exported = serde_json::json!({ "folder": canonical(folder) });
        fs::write(self.pg_root.join("exported-to.json"), exported.to_string()).unwrap();
    }

    fn set_report(&self, text: &str) {
        fs::write(self.folder.join(REPORT), text).unwrap();
    }

    fn report(&self) -> serde_json::Value {
        let text = fs::read_to_string(self.folder.join(REPORT)).unwrap();
        serde_json::from_str(&text).unwrap()
    }

    fn run(&self, stop: &mut dyn FnMut() -> Result<(), String>) -> Result<(), String> {
        self.run_with(&mut || Ok(0), stop)
    }

    fn run_with(
        &self,
        pre: &mut dyn FnMut() -> Result<u64, String>,
        stop: &mut dyn FnMut() -> Result<(), String>,
    ) -> Result<(), String> {
        remove_old_data(&self.folder, &self.pg_root, NOW, DEVICE, pre, stop)
    }

    fn assert_untouched(&self) {
        assert!(
            self.pg_root.join("data/PG_VERSION").exists(),
            "cluster must survive a refusal"
        );
        assert!(self.folder.join("note.md").exists());
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.base);
    }
}

fn canonical(path: &Path) -> String {
    dunce::canonicalize(path)
        .unwrap()
        .to_string_lossy()
        .into_owned()
}

/// Directory link for the reparse-point tests. On Windows this is a junction (`mklink /J`), which
/// needs no privilege, unlike a symlink. Returns false only when the OS refuses the link.
fn make_dir_link(target: &Path, link: &Path) -> bool {
    #[cfg(windows)]
    let made = std::process::Command::new("cmd")
        .arg("/C")
        .arg("mklink")
        .arg("/J")
        .arg(link)
        .arg(target)
        .status()
        .map(|s| s.success());
    #[cfg(unix)]
    let made = std::os::unix::fs::symlink(target, link).map(|()| true);
    match made {
        Ok(true) => true,
        Ok(false) => false,
        Err(e) if e.kind() == io::ErrorKind::PermissionDenied => false,
        Err(e) => panic!("cannot create directory link: {e}"),
    }
}

fn never_stop() -> impl FnMut() -> Result<(), String> {
    || panic!("stop hook must not run when the removal is refused")
}

#[test]
fn refuses_when_state_is_incomplete() {
    let f = Fixture::new("incomplete", Some("incomplete"), Some(good_dump().as_slice()));
    let err = f
        .run(&mut never_stop())
        .expect_err("incomplete must refuse");
    assert!(err.contains("verified"), "reason names the state: {err}");
    f.assert_untouched();
}

#[test]
fn refuses_when_state_is_none() {
    let f = Fixture::new("state-none", Some("none"), Some(good_dump().as_slice()));
    let err = f
        .run(&mut never_stop())
        .expect_err("state none must refuse");
    assert!(err.contains("verified"), "{err}");
    f.assert_untouched();
}

#[test]
fn refuses_when_there_is_no_report() {
    let f = Fixture::new("none", None, Some(good_dump().as_slice()));
    let err = f.run(&mut never_stop()).expect_err("no report must refuse");
    assert!(err.contains("verified"), "reason names the state: {err}");
    f.assert_untouched();
}

#[test]
fn refuses_when_report_is_unparsable() {
    let f = Fixture::new("bad-report", Some("verified"), Some(good_dump().as_slice()));
    f.set_report("{not json");
    let err = f
        .run(&mut never_stop())
        .expect_err("unparsable report must refuse");
    assert!(err.contains("unparsable"), "{err}");
    f.assert_untouched();
}

#[test]
fn refuses_when_the_backup_is_missing() {
    let f = Fixture::new("no-backup", Some("verified"), None);
    let err = f
        .run(&mut never_stop())
        .expect_err("missing backup must refuse");
    assert!(err.contains("backup"), "reason names the backup: {err}");
    f.assert_untouched();
}

#[test]
fn refuses_when_the_backup_is_empty() {
    let f = Fixture::new("empty-backup", Some("verified"), Some(b""));
    let err = f
        .run(&mut never_stop())
        .expect_err("empty backup must refuse");
    assert!(err.contains("backup"), "reason names the backup: {err}");
    f.assert_untouched();
}

#[test]
fn refuses_when_the_backup_is_not_a_pg_dump() {
    let f = Fixture::new("not-dump", Some("verified"), Some(b"just some text"));
    let err = f
        .run(&mut never_stop())
        .expect_err("non-dump backup must refuse");
    assert!(err.contains("PostgreSQL dump"), "{err}");
    f.assert_untouched();
}

#[test]
fn refuses_a_backup_with_a_bad_header() {
    // Magic is right but archive version 0 and format 0 are not from a custom dump.
    let mut bytes = b"PGDMP".to_vec();
    bytes.extend_from_slice(&[0, 0, 0, 4, 8, 0]);
    bytes.resize(4096, 0);
    let f = Fixture::new("bad-header", Some("verified"), Some(bytes.as_slice()));
    let err = f
        .run(&mut never_stop())
        .expect_err("bad header must refuse");
    assert!(err.contains("PostgreSQL dump"), "{err}");
    f.assert_untouched();
}

#[test]
fn refuses_a_backup_too_short_to_be_a_dump() {
    let mut bytes = b"PGDMP".to_vec();
    bytes.extend_from_slice(&[1, 16, 0, 4, 8, 1]);
    let f = Fixture::new("short-dump", Some("verified"), Some(bytes.as_slice()));
    let err = f
        .run(&mut never_stop())
        .expect_err("short backup must refuse");
    assert!(err.contains("PostgreSQL dump"), "{err}");
    f.assert_untouched();
}

#[test]
fn refuses_when_the_report_has_no_run() {
    let f = Fixture::new("no-run", Some("verified"), Some(good_dump().as_slice()));
    f.set_report(&format!(
        r#"{{"version":1,"state":"verified","backup":"{BACKUP_NAME}","runs":[]}}"#
    ));
    let err = f
        .run(&mut never_stop())
        .expect_err("a verified report without a run must refuse");
    assert!(err.contains("run"), "{err}");
    f.assert_untouched();
}

#[test]
fn only_the_newest_run_counts_for_missing_items() {
    let f = Fixture::new("older-missing", Some("verified"), Some(good_dump().as_slice()));
    f.set_report(&format!(
        r#"{{"version":1,"state":"verified","backup":"{BACKUP_NAME}","verifiedAt":"{NOW}","runs":[{}, {RUN_CLEAN}]}}"#,
        run_missing(r#"{"kind":"notes","id":"old","reason":"x"}"#)
    ));
    let mut stop = || -> Result<(), String> { Ok(()) };
    f.run(&mut stop).expect("newest run has nothing missing");
    assert!(!f.pg_root.exists(), "old run's missing item must not block");
}

#[test]
fn refuses_when_the_report_lists_missing_items() {
    let f = Fixture::new("missing", Some("verified"), Some(good_dump().as_slice()));
    f.set_report(&format!(
        r#"{{"version":1,"state":"verified","backup":"{BACKUP_NAME}","runs":[{}]}}"#,
        run_missing(r#"{"kind":"notes","id":"n1","reason":"x"}"#)
    ));
    let err = f
        .run(&mut never_stop())
        .expect_err("missing items must refuse");
    assert!(err.contains("missing"), "{err}");
    f.assert_untouched();
}

#[test]
fn refuses_when_no_run_is_from_this_device() {
    let f = Fixture::new("no-own-run", Some("verified"), Some(good_dump().as_slice()));
    let other = RUN_CLEAN.replace("dev-a", "dev-b");
    f.set_report(&format!(
        r#"{{"version":1,"state":"verified","backup":"{BACKUP_NAME}","verifiedAt":"{NOW}","runs":[{other}]}}"#
    ));
    let mut stop = || -> Result<(), String> { Ok(()) };
    assert!(f.run(&mut stop).is_err(), "another device's clean run must not count");
    f.assert_untouched();
}

#[test]
fn only_this_devices_run_counts_for_missing_items() {
    let f = Fixture::new("own-run", Some("verified"), Some(good_dump().as_slice()));
    let mine_missing = run_missing(r#"{"kind":"notes","id":"n1","reason":"x"}"#);
    let other_clean = RUN_CLEAN.replace("dev-a", "dev-b");
    f.set_report(&format!(
        r#"{{"version":1,"state":"verified","backup":"{BACKUP_NAME}","verifiedAt":"{NOW}","runs":[{mine_missing},{other_clean}]}}"#
    ));
    let mut stop = || -> Result<(), String> { Ok(()) };
    assert!(f.run(&mut stop).is_err(), "this device's own run lists missing items");
    f.assert_untouched();
}

#[test]
fn refuses_when_the_newest_run_has_no_missing_list() {
    let f = Fixture::new("no-missing-list", Some("verified"), Some(good_dump().as_slice()));
    let no_list = RUN_CLEAN.replace(r#","missing":[]"#, "");
    f.set_report(&format!(
        r#"{{"version":1,"state":"verified","backup":"{BACKUP_NAME}","verifiedAt":"{NOW}","runs":[{no_list}]}}"#
    ));
    let mut stop = || -> Result<(), String> { panic!("must not stop") };
    assert!(f.run(&mut stop).is_err(), "a run without a missing array must refuse");
    f.assert_untouched();
}

#[test]
fn refuses_when_exported_to_names_another_folder() {
    let f = Fixture::new("other-folder", Some("verified"), Some(good_dump().as_slice()));
    let other = f.base.join("other-vault");
    fs::create_dir_all(&other).unwrap();
    f.write_exported_to(&other);
    let err = f
        .run(&mut never_stop())
        .expect_err("another folder must refuse");
    assert_eq!(err, "refused: folder moved, export again");
    f.assert_untouched();
}

#[test]
fn refuses_when_exported_to_is_missing() {
    let f = Fixture::new("no-exported", Some("verified"), Some(good_dump().as_slice()));
    fs::remove_file(f.pg_root.join("exported-to.json")).unwrap();
    let err = f
        .run(&mut never_stop())
        .expect_err("missing exported-to must refuse");
    assert!(err.contains("exported"), "reason names exported-to: {err}");
    f.assert_untouched();
}

#[test]
fn refuses_when_exported_to_is_unparsable() {
    let f = Fixture::new("bad-exported", Some("verified"), Some(good_dump().as_slice()));
    fs::write(f.pg_root.join("exported-to.json"), "{nope").unwrap();
    let err = f
        .run(&mut never_stop())
        .expect_err("unparsable exported-to must refuse");
    assert!(err.contains("exported-to.json is unparsable"), "{err}");
    f.assert_untouched();
}

#[test]
fn refuses_when_the_cluster_holds_a_reparse_point() {
    let f = Fixture::new("reparse", Some("verified"), Some(good_dump().as_slice()));
    let outside = f.base.join("outside");
    fs::create_dir_all(&outside).unwrap();
    fs::write(outside.join("precious.txt"), "not ours").unwrap();
    if !make_dir_link(&outside, &f.pg_root.join("data/pg_wal")) {
        eprintln!("skipped: cannot create a directory link here");
        return;
    }
    let err = f
        .run(&mut never_stop())
        .expect_err("reparse point must refuse");
    assert!(err.contains("reparse point"), "{err}");
    assert!(
        outside.join("precious.txt").exists(),
        "link target must never be followed"
    );
    f.assert_untouched();
}

#[test]
fn refuses_when_the_cluster_root_is_a_link() {
    let f = Fixture::new("root-link", Some("verified"), Some(good_dump().as_slice()));
    let real = f.base.join("real-pg");
    fs::rename(&f.pg_root, &real).unwrap();
    if !make_dir_link(&real, &f.pg_root) {
        eprintln!("skipped: cannot create a directory link here");
        fs::rename(&real, &f.pg_root).unwrap();
        return;
    }
    let err = f
        .run(&mut never_stop())
        .expect_err("link as cluster root must refuse");
    assert!(err.contains("link or junction"), "{err}");
    assert!(
        real.join("data/PG_VERSION").exists(),
        "link target must never be deleted"
    );
}

#[test]
fn stop_failure_keeps_the_cluster() {
    let f = Fixture::new("stop-fails", Some("verified"), Some(good_dump().as_slice()));
    let mut stop = || Err("postgres would not stop".to_owned());
    let err = f.run(&mut stop).expect_err("stop failure must abort");
    assert!(err.contains("would not stop"), "{err}");
    f.assert_untouched();
    assert_eq!(
        f.report()["state"],
        "verified",
        "no removing state before a clean stop"
    );
}

/// A short-lived child that stands in for postgres. On Windows it is a copy of ping.exe named
/// postgres.exe, so the liveness check sees the image name it looks for; it exits by itself.
fn fake_postmaster() -> std::process::Child {
    if cfg!(windows) {
        let dir = std::env::temp_dir().join(format!("wf-m097-fake-pg-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let exe = dir.join("postgres.exe");
        let _copied = fs::copy(r"C:\Windows\System32\PING.EXE", &exe).unwrap();
        std::process::Command::new(&exe)
            .args(["-n", "10", "127.0.0.1"])
            .stdout(std::process::Stdio::null())
            .spawn()
            .unwrap()
    } else {
        std::process::Command::new("sleep").arg("10").spawn().unwrap()
    }
}

#[test]
fn postmaster_pid_left_after_stop_keeps_the_cluster() {
    let f = Fixture::new("pid-left", Some("verified"), Some(good_dump().as_slice()));
    // A live process whose image is postgres.exe stands in for a running postmaster.
    let _fake = fake_postmaster();
    fs::write(
        f.pg_root.join("data/postmaster.pid"),
        format!("{}\n", _fake.id()),
    )
    .unwrap();
    let mut stop = || Ok(());
    let err = f.run(&mut stop).expect_err("a live postmaster must refuse the delete");
    assert!(err.contains("postmaster.pid"), "{err}");
    f.assert_untouched();
}

#[test]
fn stale_postmaster_pid_of_a_dead_process_does_not_block_removal() {
    let f = Fixture::new("pid-stale", Some("verified"), Some(good_dump().as_slice()));
    // A crash leaves postmaster.pid behind; its PID no longer belongs to any process.
    fs::write(f.pg_root.join("data/postmaster.pid"), "999999999\n").unwrap();
    let mut stop = || Ok(());
    f.run(&mut stop).expect("a stale postmaster.pid must not block the removal");
    assert!(!f.pg_root.exists(), "cluster dir must be deleted");
}

#[test]
fn resume_stops_postgres_before_deleting() {
    let f = Fixture::new("resume-stop", None, Some(good_dump().as_slice()));
    f.set_report(&format!(
        r#"{{"version":1,"state":"removing","removingDeviceId":"{DEVICE}","backup":"{BACKUP_NAME}","verifiedAt":"{NOW}","runs":[{RUN_CLEAN}]}}"#
    ));
    let mut stopped = 0;
    let pg_root = f.pg_root.clone();
    let mut stop = || {
        stopped += 1;
        assert!(pg_root.exists(), "postgres must stop while the cluster still exists");
        Ok(())
    };
    f.run(&mut stop).expect("a resumed removal finishes");
    assert_eq!(stopped, 1, "a resumed removal must stop postgres before deleting");
    assert!(!f.pg_root.exists());
}

#[test]
fn deletes_only_the_cluster_dir_and_records_removed_at() {
    let f = Fixture::new("happy", Some("verified"), Some(good_dump().as_slice()));
    let mut stopped = 0;
    let mut stop = || {
        stopped += 1;
        Ok(())
    };
    f.run(&mut stop)
        .expect("verified + backup + matching folder must remove");
    assert_eq!(stopped, 1, "cluster stopped exactly once, before deletion");
    assert!(!f.pg_root.exists(), "cluster dir deleted");
    assert!(
        !f.base.join("local-db-backups").exists(),
        "old local-db backups are deleted with the cluster"
    );
    assert!(
        f.folder.join("note.md").exists(),
        "workspace files untouched"
    );
    assert!(f.folder.join(BACKUP).exists(), "migration backup kept");
    let value = f.report();
    assert_eq!(value["removedAt"], NOW);
    assert_eq!(value["state"], "removed");
    assert!(
        !f.folder.join(format!("{REPORT}.part")).exists(),
        "no partial report left behind"
    );
}

#[test]
fn a_removed_cluster_is_marked_so_a_relaunch_never_restores_it() {
    let f = Fixture::new("marked", Some("verified"), Some(good_dump().as_slice()));
    assert!(!old_db_removed(&f.pg_root), "no marker before a removal");
    f.run(&mut || Ok(())).expect("run removes");
    assert!(!f.pg_root.exists(), "cluster dir is gone");
    assert!(old_db_removed(&f.pg_root), "marker stops the relaunch restore");
}

#[test]
fn another_devices_removal_in_progress_is_refused_and_keeps_the_backups() {
    let f = Fixture::new("other-device-backups", Some("verified"), Some(good_dump().as_slice()));
    let run_b = RUN_CLEAN.replace(r#""deviceId":"dev-a""#, &format!(r#""deviceId":"dev-b","backup":"{BACKUP_NAME}""#));
    let report = format!(
        r#"{{"version":1,"state":"removing","removingDeviceId":"{DEVICE}","backup":"{BACKUP_NAME}","verifiedAt":"{NOW}","runs":[{RUN_CLEAN},{run_b}]}}"#
    );
    f.set_report(&report);
    fs::remove_dir_all(&f.pg_root).unwrap();
    let mut stop = never_stop();
    let result = remove_old_data(&f.folder, &f.pg_root, NOW, "dev-b", &mut || Ok(0), &mut stop);
    let err = result.expect_err("dev-b must not finish dev-a's removal");
    assert!(err.contains("exported"), "dev-b runs its own checks, which refuse: {err}");
    assert!(
        f.base.join("local-db-backups/keep.dump").exists(),
        "dev-b must not delete the backups"
    );
    assert_eq!(f.report()["removingDeviceId"], DEVICE);
}

#[test]
fn the_backup_name_comes_from_this_devices_own_run() {
    let f = Fixture::new("run-backup", Some("verified"), None);
    fs::write(f.folder.join(DIR).join("custom.dump"), good_dump()).unwrap();
    let run = RUN_CLEAN.replace(r#""deviceId":"dev-a""#, r#""deviceId":"dev-a","backup":"custom.dump""#);
    f.set_report(&format!(
        r#"{{"version":1,"state":"verified","backup":"{BACKUP_NAME}","verifiedAt":"{NOW}","runs":[{run}]}}"#
    ));
    f.run(&mut || Ok(())).expect("the dump this device's run names is the one checked");
    assert!(f.folder.join(DIR).join("custom.dump").exists(), "migration dump kept");
}

/// Device A's run has no backup of its own; device B wrote the report-level backup and its dump.
fn report_with_another_devices_backup(f: &Fixture) {
    fs::write(f.folder.join(DIR).join("b.dump"), good_dump()).unwrap();
    let run_b = RUN_CLEAN.replace(r#""deviceId":"dev-a""#, r#""deviceId":"dev-b","backup":"b.dump""#);
    f.set_report(&format!(
        r#"{{"version":1,"state":"verified","backup":"b.dump","verifiedAt":"{NOW}","runs":[{RUN_CLEAN},{run_b}]}}"#
    ));
}

#[test]
fn a_device_is_refused_when_only_another_devices_backup_is_named() {
    let f = Fixture::new("other-backup", Some("verified"), None);
    report_with_another_devices_backup(&f);
    let err = f.run(&mut never_stop()).expect_err("A must not remove using B's dump");
    assert!(err.contains("belongs to another device"), "{err}");
    assert!(f.pg_root.join("data/PG_VERSION").exists(), "local cluster untouched");
}

#[test]
fn a_run_with_conflict_copies_is_refused() {
    let f = Fixture::new("conflict-run", Some("verified"), Some(good_dump().as_slice()));
    let run = RUN_CLEAN.replace(
        r#""deviceId":"dev-a""#,
        r#""deviceId":"dev-a","conflicts":["note (conflict).md"]"#,
    );
    f.set_report(&format!(
        r#"{{"version":1,"state":"verified","backup":"{BACKUP_NAME}","verifiedAt":"{NOW}","runs":[{run}]}}"#
    ));
    let err = f.run(&mut never_stop()).expect_err("conflict copies must refuse");
    assert!(err.contains("this device's export left conflict copies; resolve them first"), "{err}");
    f.assert_untouched();
}

#[test]
fn a_kind_with_conflict_copies_is_refused() {
    let f = Fixture::new("conflict-kind", Some("verified"), Some(good_dump().as_slice()));
    let run = RUN_CLEAN.replace(
        r#""kinds":{"notes":{"db":1,"files":1}}"#,
        r#""kinds":{"notes":{"db":1,"files":1,"conflicts":["note (conflict).md"]}}"#,
    );
    f.set_report(&format!(
        r#"{{"version":1,"state":"verified","backup":"{BACKUP_NAME}","verifiedAt":"{NOW}","runs":[{run}]}}"#
    ));
    let err = f.run(&mut never_stop()).expect_err("kind conflict copies must refuse");
    assert!(err.contains("this device's export left conflict copies; resolve them first"), "{err}");
    f.assert_untouched();
}

#[test]
fn status_does_not_report_another_devices_dump_as_this_devices_backup() {
    let f = Fixture::new("other-backup-status", Some("verified"), None);
    report_with_another_devices_backup(&f);
    let value = serde_json::to_value(migration_status(&f.folder, &f.pg_root, DEVICE)).unwrap();
    assert!(value.get("backupPath").is_none(), "{value}");
}

#[test]
fn a_resume_with_the_cluster_gone_finishes_the_backup_delete() {
    let f = Fixture::new("resume-gone", Some("verified"), Some(good_dump().as_slice()));
    fs::write(f.base.join("old-db-removed"), "").unwrap();
    f.set_report(&format!(
        r#"{{"version":1,"state":"removing","removingDeviceId":"{DEVICE}","backup":"{BACKUP_NAME}","verifiedAt":"{NOW}","runs":[{RUN_CLEAN}]}}"#
    ));
    fs::remove_dir_all(&f.pg_root).unwrap();
    // A resume stops postgres first (a crash may have left it running); the stop is allowed here.
    f.run(&mut || Ok(())).expect("the starting device resumes and finishes");
    assert!(!f.base.join("local-db-backups").exists(), "backups deleted on resume");
    assert_eq!(f.report()["state"], "removed");
}

#[test]
fn a_junction_inside_local_db_backups_is_refused() {
    let f = Fixture::new("backups-junction", Some("verified"), Some(good_dump().as_slice()));
    let elsewhere = f.base.join("elsewhere");
    fs::create_dir_all(&elsewhere).unwrap();
    if !make_dir_link(&elsewhere, &f.base.join("local-db-backups/linked")) {
        return;
    }
    let err = f.run(&mut never_stop()).expect_err("a junction in the backups must refuse");
    assert!(err.contains("local-db-backups"), "{err}");
    f.assert_untouched();
    assert!(f.base.join("local-db-backups/keep.dump").exists(), "backups kept on refusal");
}

#[test]
fn a_second_run_after_success_refuses() {
    let f = Fixture::new("second-run", Some("verified"), Some(good_dump().as_slice()));
    f.run(&mut || Ok(())).expect("first run removes");
    let mut stop = || panic!("second run must not stop the cluster again");
    let err = f.run(&mut stop).expect_err("second run must refuse");
    assert!(err.contains("already removed"), "{err}");
}

#[test]
fn refuses_when_secrets_moved_is_missing() {
    let f = Fixture::new("secrets-missing", Some("verified"), Some(good_dump().as_slice()));
    fs::remove_file(f.folder.join(SECRETS)).unwrap();
    let mut stopped = false;
    let mut stop = || {
        stopped = true;
        Ok(())
    };
    let err = f
        .run(&mut stop)
        .expect_err("missing secrets-moved.json must refuse");
    assert!(err.contains("secrets-moved"), "{err}");
    assert!(!stopped, "cluster must not stop on a refusal");
    f.assert_untouched();
}

#[test]
fn refuses_when_secrets_moved_is_unparsable() {
    let f = Fixture::new("secrets-garbage", Some("verified"), Some(good_dump().as_slice()));
    fs::write(f.folder.join(SECRETS), "{not json").unwrap();
    let err = f
        .run(&mut never_stop())
        .expect_err("unparsable secrets-moved.json must refuse");
    assert!(err.contains("unparsable"), "{err}");
    f.assert_untouched();
}

#[test]
fn refuses_when_secrets_moved_count_is_short() {
    let f = Fixture::new("secrets-short", Some("verified"), Some(good_dump().as_slice()));
    fs::write(f.folder.join(SECRETS), secrets_json(1)).unwrap();
    let mut stopped = false;
    let mut stop = || {
        stopped = true;
        Ok(())
    };
    let err = f
        .run_with(&mut || Ok(2), &mut stop)
        .expect_err("2 local_secrets rows vs count 1 must refuse");
    assert!(err.contains("less than local_secrets rows (2)"), "{err}");
    assert!(!stopped, "cluster must not stop on a refusal");
    f.assert_untouched();
}

#[test]
fn secrets_gate_passes_when_count_covers_local_rows() {
    let f = Fixture::new("secrets-ok", Some("verified"), Some(good_dump().as_slice()));
    fs::write(f.folder.join(SECRETS), secrets_json(2)).unwrap();
    f.run_with(&mut || Ok(2), &mut || Ok(()))
        .expect("count 2 covers 2 rows");
    assert!(!f.pg_root.exists(), "cluster removed");
}

/// Sets `finishedAt` on this device's run. The freshness gate reads that run, not the top-level
/// `verifiedAt`, which any device sharing the folder can overwrite.
fn set_finished_at(f: &Fixture, ts: Option<&str>) {
    let mut report = f.report();
    let run = report["runs"].as_array_mut().unwrap().last_mut().unwrap();
    match ts {
        Some(ts) => run["finishedAt"] = ts.into(),
        None => {
            let _removed = run.as_object_mut().unwrap().remove("finishedAt");
        }
    }
    f.set_report(&report.to_string());
}

#[test]
fn refuses_when_verified_at_is_older_than_ten_minutes() {
    let f = Fixture::new("stale", Some("verified"), Some(good_dump().as_slice()));
    set_finished_at(&f, Some("2026-11-23T07:49:59Z"));
    let err = f
        .run(&mut never_stop())
        .expect_err("11 minute old verify must refuse");
    assert!(err.contains("stale"), "{err}");
    f.assert_untouched();
    assert_eq!(f.report()["state"], "verified", "report not moved");
}

#[test]
fn device_bs_fresh_verify_does_not_let_device_a_pass() {
    // Device A verified at 07:30; device B verified at 08:00 and overwrote the top-level stamp.
    let f = Fixture::new("other-verify", Some("verified"), Some(good_dump().as_slice()));
    let mut report = f.report();
    report["runs"][0]["finishedAt"] = "2026-11-23T07:30:00Z".into();
    report["runs"][0]["backup"] = BACKUP_NAME.into();
    report["runs"].as_array_mut().unwrap().push(serde_json::json!({
        "startedAt": NOW, "finishedAt": NOW, "sources": [], "kinds": {},
        "blobs": {"db": 0, "verified": 0}, "deviceId": "dev-b", "missing": []
    }));
    report["verifiedAt"] = NOW.into();
    f.set_report(&report.to_string());
    let err = f
        .run(&mut never_stop())
        .expect_err("device A's own verify is stale even though B's is fresh");
    assert!(err.contains("stale"), "{err}");
    f.assert_untouched();
}

#[test]
fn refuses_secrets_moved_written_by_another_device() {
    let f = Fixture::new("secrets-other", Some("verified"), Some(good_dump().as_slice()));
    fs::write(f.folder.join(SECRETS), r#"{"count":0,"deviceId":"dev-b"}"#).unwrap();
    let err = f.run(&mut never_stop()).expect_err("another device's secrets must refuse");
    assert!(err.contains("another device"), "{err}");
    f.assert_untouched();

    fs::write(f.folder.join(SECRETS), r#"{"count":0}"#).unwrap();
    let err = f.run(&mut never_stop()).expect_err("secrets without a deviceId must refuse");
    assert!(err.contains("deviceId"), "{err}");
    f.assert_untouched();
}

#[test]
fn accepts_verified_at_exactly_ten_minutes_old() {
    let f = Fixture::new("fresh-edge", Some("verified"), Some(good_dump().as_slice()));
    set_finished_at(&f, Some("2026-11-23T07:50:00.250Z"));
    let mut stopped = false;
    f.run(&mut || {
        stopped = true;
        Ok(())
    })
    .expect("10 minute old verify is still fresh");
    assert!(stopped, "PG stopped before deletion");
    assert!(!f.pg_root.exists());
}

#[test]
fn refuses_when_verified_at_is_missing_or_in_the_future() {
    let f = Fixture::new("no-verified-at", Some("verified"), Some(good_dump().as_slice()));
    set_finished_at(&f, None);
    let err = f.run(&mut never_stop()).expect_err("no finishedAt must refuse");
    assert!(err.contains("finishedAt"), "{err}");
    f.assert_untouched();

    let future = Fixture::new("future-verified-at", Some("verified"), Some(good_dump().as_slice()));
    set_finished_at(&future, Some("2026-11-23T09:00:00Z"));
    let err = future
        .run(&mut never_stop())
        .expect_err("future finishedAt must refuse");
    assert!(err.contains("clock"), "{err}");
    future.assert_untouched();
}

#[test]
fn refuses_when_exported_file_is_deleted_after_verify() {
    // The TS verify ran; its exported file is gone, so the gate refuses before PG is stopped.
    let f = Fixture::new("reverify", Some("verified"), Some(good_dump().as_slice()));
    let exported = f.folder.join("exported.md");
    fs::write(&exported, "exported note").unwrap();
    fs::remove_file(&exported).unwrap();
    f.write_exported_to(&f.folder.clone());
    fs::remove_file(f.pg_root.join("exported-to.json")).unwrap();
    let err = f
        .run(&mut never_stop())
        .expect_err("missing exported-to must refuse");
    assert!(err.contains("exported-to.json"), "{err}");
    f.assert_untouched();
    assert_eq!(
        f.report()["state"],
        "verified",
        "report not moved to removing"
    );
}

#[test]
fn a_resume_is_not_stranded_by_another_devices_top_level_state() {
    let f = Fixture::new("resume-b-state", Some("verified"), Some(good_dump().as_slice()));
    // dev-a started the removal; dev-b then wrote a top-level "incomplete" state.
    f.set_report(&format!(
        r#"{{"version":1,"state":"incomplete","removingDeviceId":"{DEVICE}","removals":{{"{DEVICE}":{{"state":"removing"}}}},"backup":"{BACKUP_NAME}","verifiedAt":"{NOW}","runs":[{RUN_CLEAN}]}}"#
    ));
    fs::remove_file(f.pg_root.join("exported-to.json")).unwrap();
    f.run(&mut || Ok(())).expect("own removing entry decides, not the top-level state");
    assert!(!f.pg_root.exists(), "cluster deleted on resume");
    assert_eq!(f.report()["removals"][DEVICE]["state"], "removed");
}

#[test]
fn resumes_a_removing_report_this_device_started() {
    let f = Fixture::new("resume", Some("verified"), Some(good_dump().as_slice()));
    f.set_report(&format!(
        r#"{{"version":1,"state":"removing","removingDeviceId":"{DEVICE}","backup":"{BACKUP_NAME}","verifiedAt":"{NOW}","runs":[{RUN_CLEAN}]}}"#
    ));
    fs::remove_file(f.pg_root.join("exported-to.json")).unwrap();
    let mut stop = || Ok(());
    f.run(&mut stop).expect("own removing report resumes deletion");
    assert!(!f.pg_root.exists(), "rest of the cluster deleted");
    assert_eq!(f.report()["state"], "removed");
}

#[test]
fn another_devices_report_writes_during_the_removal_survive() {
    let f = Fixture::new("race", Some("verified"), Some(good_dump().as_slice()));
    f.set_report(&format!(
        r#"{{"version":1,"state":"verified","backup":"{BACKUP_NAME}","verifiedAt":"{NOW}","runs":[{RUN_CLEAN}]}}"#
    ));
    let dev_b_run = RUN_CLEAN.replace("\"deviceId\":\"dev-a\"", "\"deviceId\":\"dev-b\"");
    // dev-b writes report.json while this device is between its read and its writes.
    let mut stop = || {
        let text = format!(
            r#"{{"version":1,"state":"verified","backup":"{BACKUP_NAME}","verifiedAt":"{NOW}","removals":{{"dev-b":{{"state":"removed","removedAt":"{NOW}"}}}},"runs":[{RUN_CLEAN},{dev_b_run}]}}"#
        );
        fs::write(f.folder.join(REPORT), text).unwrap();
        Ok(())
    };
    f.run(&mut stop).expect("removal runs although another device wrote");
    let r = f.report();
    assert_eq!(r["state"], "removed");
    assert_eq!(r["removals"]["dev-a"]["state"], "removed");
    assert_eq!(r["removals"]["dev-b"]["state"], "removed", "dev-b's removal entry kept");
    assert!(
        r["runs"].as_array().unwrap().iter().any(|run| run["deviceId"] == "dev-b"),
        "dev-b's run kept"
    );
}

#[test]
fn another_devices_removing_report_refuses_unless_own_checks_pass() {
    let f = Fixture::new("other-device", Some("verified"), Some(good_dump().as_slice()));
    f.set_report(&format!(
        r#"{{"version":1,"state":"removing","removingDeviceId":"dev-b","backup":"{BACKUP_NAME}","verifiedAt":"{NOW}","runs":[{RUN_CLEAN}]}}"#
    ));
    fs::remove_file(f.pg_root.join("exported-to.json")).unwrap();
    let mut stop = || panic!("must not stop");
    let err = f.run(&mut stop).expect_err("device A must run its own exported-to check");
    assert!(err.contains("exported"), "{err}");
    f.assert_untouched();
}

#[test]
fn record_exported_to_names_this_folder() {
    let f = Fixture::new("record", None, None);
    fs::remove_file(f.pg_root.join("exported-to.json")).unwrap();
    record_exported_to(&f.pg_root, &f.folder).expect("record must succeed");
    let text = fs::read_to_string(f.pg_root.join("exported-to.json")).unwrap();
    let value: serde_json::Value = serde_json::from_str(&text).unwrap();
    assert_eq!(value["folder"], canonical(&f.folder));
}

// ---- migrate_097_status wire shape (camelCase, optional fields omitted when absent) ----

use weaveforge_shell_lib::migrate_097::status::migration_status;

#[test]
fn status_reports_removing_device_and_unverified_own_run() {
    let f = Fixture::new("status-removing", Some("removing"), Some(good_dump().as_slice()));
    let aborted = RUN_CLEAN.replace(r#""state":"verified""#, r#""state":"aborted""#);
    f.set_report(&format!(
        r#"{{"version":1,"state":"removing","removingDeviceId":"{DEVICE}","backup":"{BACKUP_NAME}","verifiedAt":"{NOW}","runs":[{aborted}]}}"#
    ));
    let value = serde_json::to_value(migration_status(&f.folder, &f.pg_root, DEVICE)).unwrap();
    assert_eq!(value["removingDeviceId"], DEVICE);
    assert_eq!(value["ownRunVerified"], false);
}

#[test]
fn status_reports_not_exported_here_for_another_folder() {
    let f = Fixture::new("status-moved", Some("verified"), Some(good_dump().as_slice()));
    let other = f.base.join("elsewhere");
    fs::create_dir_all(&other).unwrap();
    fs::write(
        f.pg_root.join("exported-to.json"),
        serde_json::json!({ "folder": other.to_string_lossy() }).to_string(),
    )
    .unwrap();
    let value = serde_json::to_value(migration_status(&f.folder, &f.pg_root, DEVICE)).unwrap();
    assert_eq!(value["exportedHere"], false);
}

#[test]
fn status_absent_report_with_exported_to_is_unavailable_not_none() {
    let f = Fixture::new("absent-exported", None, None);
    let value = serde_json::to_value(migration_status(&f.folder, &f.pg_root, DEVICE)).unwrap();
    assert_eq!(value["state"], "unavailable");
}

#[test]
fn a_removal_is_recorded_under_this_devices_removals_entry() {
    let f = Fixture::new("removals-entry", Some("verified"), Some(good_dump().as_slice()));
    f.run(&mut || Ok(())).expect("removal succeeds");
    let report = f.report();
    assert_eq!(report["removals"][DEVICE]["state"], "removed");
    assert_eq!(report["removals"][DEVICE]["removedAt"], NOW);
}

#[test]
fn status_reads_removed_at_only_from_this_devices_removals_entry() {
    let f = Fixture::new("removals-status", Some("removed"), None);
    f.set_report(&format!(
        r#"{{"version":1,"state":"removed","runs":[{RUN_CLEAN}],"removals":{{"dev-b":{{"state":"removed","removedAt":"2026-11-23T07:00:00Z"}}}}}}"#
    ));
    let other = serde_json::to_value(migration_status(&f.folder, &f.pg_root, DEVICE)).unwrap();
    assert!(other.get("removedAt").is_none(), "another device's removal: {other}");
    f.set_report(&format!(
        r#"{{"version":1,"state":"removed","runs":[{RUN_CLEAN}],"removals":{{"{DEVICE}":{{"state":"removed","removedAt":"{NOW}"}}}}}}"#
    ));
    let own = serde_json::to_value(migration_status(&f.folder, &f.pg_root, DEVICE)).unwrap();
    assert_eq!(own["removedAt"], NOW);
}

#[test]
fn status_never_says_none_for_an_unreadable_report() {
    let f = Fixture::new("status-bad", Some("verified"), None);
    f.set_report("{ not json");
    let value = serde_json::to_value(migration_status(&f.folder, &f.pg_root, DEVICE)).unwrap();
    assert_eq!(value["state"], "unavailable");
    assert!(value.get("removedAt").is_none());
}

#[test]
fn status_unreadable_report_after_removal_says_removed() {
    let f = Fixture::new("status-bad-removed", Some("verified"), None);
    f.set_report("{ not json");
    fs::write(f.base.join("old-db-removed"), "").unwrap();
    let value = serde_json::to_value(migration_status(&f.folder, &f.pg_root, DEVICE)).unwrap();
    assert_eq!(value["state"], "removed");
    assert_eq!(value["removingDeviceId"], DEVICE);
}

#[test]
fn status_report_without_a_state_is_unavailable_not_none() {
    let f = Fixture::new("status-no-state", Some("verified"), None);
    f.set_report(&format!(
        r#"{{"version":1,"backup":"{BACKUP_NAME}","verifiedAt":"{NOW}","runs":[{RUN_CLEAN}]}}"#
    ));
    let value = serde_json::to_value(migration_status(&f.folder, &f.pg_root, DEVICE)).unwrap();
    assert_eq!(value["state"], "unavailable");
}

#[test]
fn status_report_with_a_non_string_state_is_unavailable_not_none() {
    let f = Fixture::new("status-num-state", Some("verified"), None);
    f.set_report(&format!(
        r#"{{"version":1,"state":5,"backup":"{BACKUP_NAME}","verifiedAt":"{NOW}","runs":[{RUN_CLEAN}]}}"#
    ));
    let value = serde_json::to_value(migration_status(&f.folder, &f.pg_root, DEVICE)).unwrap();
    assert_eq!(value["state"], "unavailable");
}

#[test]
fn status_report_with_an_unknown_state_is_unavailable() {
    let f = Fixture::new("status-unknown-state", Some("verified"), None);
    f.set_report(&format!(
        r#"{{"version":1,"state":"bogus","backup":"{BACKUP_NAME}","verifiedAt":"{NOW}","runs":[{RUN_CLEAN}]}}"#
    ));
    let value = serde_json::to_value(migration_status(&f.folder, &f.pg_root, DEVICE)).unwrap();
    assert_eq!(value["state"], "unavailable");
}

#[test]
fn status_for_a_verified_migration_has_camel_case_keys() {
    let f = Fixture::new("status-verified", Some("verified"), Some(good_dump().as_slice()));
    let value = serde_json::to_value(migration_status(&f.folder, &f.pg_root, DEVICE)).unwrap();
    assert_eq!(
        value,
        serde_json::json!({
            "state": "verified",
            "deviceId": DEVICE,
            "exportedHere": true,
            "ownRunVerified": true,
            "verifiedAt": NOW,
            "exportedTo": canonical(&f.folder),
            "backupPath": f.folder.join(".weaveforge/migration-0.9.7").join("pre-migration.dump").to_string_lossy(),
        })
    );
}

#[test]
fn status_lists_missing_kinds_once_and_sorted() {
    let f = Fixture::new("status-missing", Some("incomplete"), Some(good_dump().as_slice()));
    let missing = r#"{"kind":"notes","id":"a","reason":"r"},
            {"kind":"ink","id":"b","reason":"r"},
            {"kind":"notes","id":"c","reason":"r"}"#;
    f.set_report(&format!(
        r#"{{"version":1,"state":"incomplete","backup":"x","runs":[{}]}}"#,
        run_missing(missing)
    ));
    let value = serde_json::to_value(migration_status(&f.folder, &f.pg_root, DEVICE)).unwrap();
    assert_eq!(value["missing"], serde_json::json!(["ink", "notes"]));
    assert!(
        value.get("removedAt").is_none(),
        "removedAt omitted until removed"
    );
}

#[test]
fn status_reports_removed_at_and_none_without_a_report() {
    let f = Fixture::new("status-removed", Some("removed"), None);
    f.set_report(&format!(
        r#"{{"version":1,"state":"removed","runs":[],"removals":{{"{DEVICE}":{{"state":"removed","removedAt":"2026-11-23T08:00:00Z"}}}}}}"#
    ));
    let value = serde_json::to_value(migration_status(&f.folder, &f.pg_root, DEVICE)).unwrap();
    assert_eq!(value["removedAt"], "2026-11-23T08:00:00Z");
    assert!(
        value.get("backupPath").is_none(),
        "no backup key in this report: {value}"
    );

    // Neither report.json nor exported-to.json: the only case that is `none`.
    fs::remove_file(f.folder.join(REPORT)).unwrap();
    fs::remove_file(f.pg_root.join("exported-to.json")).unwrap();
    let none = serde_json::to_value(migration_status(&f.folder, &f.pg_root, DEVICE)).unwrap();
    assert_eq!(none["state"], "none");
    assert!(none.get("missing").is_none());
    assert!(none.get("exportedTo").is_none());
}

#[test]
fn uses_the_backup_name_the_report_records() {
    let f = Fixture::new("named", Some("verified"), None);
    fs::write(f.folder.join(DIR).join("custom.dump"), good_dump()).unwrap();
    f.set_report(&format!(
        r#"{{"version":1,"state":"verified","backup":"custom.dump","verifiedAt":"{NOW}","runs":[{RUN_CLEAN}]}}"#
    ));
    f.run(&mut || Ok(())).expect("the dump the report names passes");
}

#[test]
fn refuses_a_backup_name_that_leaves_the_migration_dir() {
    for bad in ["../escape.dump", "sub/x.dump", ".."] {
        let f = Fixture::new("sep", Some("verified"), Some(good_dump().as_slice()));
        f.set_report(&format!(
            r#"{{"version":1,"state":"verified","backup":"{bad}","verifiedAt":"{NOW}","runs":[{RUN_CLEAN}]}}"#
        ));
        let err = f.run(&mut never_stop()).expect_err("a path in the backup name must refuse");
        assert!(err.contains("backup name"), "{bad}: {err}");
        f.assert_untouched();
    }
}

#[test]
fn falls_back_to_the_default_name_only_when_the_report_has_no_backup_field() {
    let f = Fixture::new("nofield", Some("verified"), Some(good_dump().as_slice()));
    f.set_report(&format!(
        r#"{{"version":1,"state":"verified","verifiedAt":"{NOW}","runs":[{RUN_CLEAN}]}}"#
    ));
    f.run(&mut || Ok(())).expect("an old report without backup uses pre-migration.dump");
}

#[test]
fn refuses_an_aborted_run_even_when_it_lists_no_missing_items() {
    let f = Fixture::new("aborted", Some("verified"), Some(good_dump().as_slice()));
    let aborted = format!(
        r#"{{"startedAt":"{NOW}","finishedAt":"{NOW}","state":"incomplete","sources":[],"kinds":{{"notes":{{"db":1,"files":1}}}},"blobs":{{"db":0,"verified":0}},"deviceId":"dev-a","missing":[]}}"#
    );
    f.set_report(&format!(
        r#"{{"version":1,"state":"verified","backup":"{BACKUP_NAME}","verifiedAt":"{NOW}","runs":[{aborted}]}}"#
    ));
    let err = f.run(&mut never_stop()).expect_err("an aborted run must refuse");
    assert!(err.contains("not verified"), "{err}");
    f.assert_untouched();
}

#[test]
fn refuses_a_kind_whose_db_and_file_counts_differ() {
    let f = Fixture::new("differ", Some("verified"), Some(good_dump().as_slice()));
    let differ = RUN_CLEAN.replace(r#""notes":{"db":1,"files":1}"#, r#""notes":{"db":2,"files":1}"#);
    f.set_report(&format!(
        r#"{{"version":1,"state":"verified","backup":"{BACKUP_NAME}","verifiedAt":"{NOW}","runs":[{differ}]}}"#
    ));
    let err = f.run(&mut never_stop()).expect_err("db and files must match per kind");
    assert!(err.contains("notes"), "{err}");
    f.assert_untouched();
}

#[test]
fn refuses_a_run_with_no_kinds_to_compare() {
    let f = Fixture::new("nokinds", Some("verified"), Some(good_dump().as_slice()));
    let empty = RUN_CLEAN.replace(r#""kinds":{"notes":{"db":1,"files":1}}"#, r#""kinds":{}"#);
    f.set_report(&format!(
        r#"{{"version":1,"state":"verified","backup":"{BACKUP_NAME}","verifiedAt":"{NOW}","runs":[{empty}]}}"#
    ));
    let err = f.run(&mut never_stop()).expect_err("a run with no kinds must refuse");
    assert!(err.contains("no kinds"), "{err}");
    f.assert_untouched();
}

#[test]
fn another_devices_removing_report_needs_this_devices_own_checks() {
    let f = Fixture::new("removing-b", Some("removing"), Some(good_dump().as_slice()));
    let stale = RUN_CLEAN.replace(
        r#""finishedAt":"2026-11-23T08:00:00Z""#,
        r#""finishedAt":"2026-11-23T07:00:00Z""#,
    );
    f.set_report(&format!(
        r#"{{"version":1,"state":"removing","removingDeviceId":"dev-b","backup":"{BACKUP_NAME}","verifiedAt":"{NOW}","runs":[{stale}]}}"#
    ));
    let err = f.run(&mut never_stop()).expect_err("device A must not resume on B's say-so");
    assert!(err.contains("stale"), "{err}");
    f.assert_untouched();
}

#[test]
fn secrets_moved_for_another_device_does_not_count_for_this_one() {
    let f = Fixture::new("secrets-b", Some("verified"), Some(good_dump().as_slice()));
    fs::remove_file(f.folder.join(SECRETS)).unwrap();
    let dir = f.folder.join(DIR);
    fs::write(dir.join("secrets-moved-dev-b.json"), secrets_json(0).replace(DEVICE, "dev-b")).unwrap();
    let err = f.run(&mut never_stop()).expect_err("only this device's secrets file counts");
    assert!(err.contains("secrets-moved"), "{err}");
    f.assert_untouched();
}

// ---- item 13: an unreadable report.json is kept as .bad, never merged; stale .part is replaced ----

#[test]
fn an_unparsable_report_is_moved_aside_as_bad_and_never_merged() {
    let f = Fixture::new("unparsable", Some("verified"), Some(good_dump().as_slice()));
    f.set_report("{ not json");
    let err = f.run(&mut never_stop()).expect_err("an unparsable report must refuse");
    assert_eq!(err, "refused: migration report is unparsable");
    assert!(f.folder.join(format!("{REPORT}.bad")).exists(), "report must be kept as .bad");
    assert!(!f.folder.join(REPORT).exists(), "the unparsable report must not stay in place");
    assert_eq!(
        fs::read_to_string(f.folder.join(format!("{REPORT}.bad"))).unwrap(),
        "{ not json"
    );
    f.assert_untouched();
}

#[test]
fn an_existing_bad_file_is_never_overwritten() {
    let f = Fixture::new("existing-bad", Some("verified"), Some(good_dump().as_slice()));
    fs::write(f.folder.join(format!("{REPORT}.bad")), "earlier evidence").unwrap();
    f.set_report("{ broken again");
    let _ = f.run(&mut never_stop());
    assert_eq!(
        fs::read_to_string(f.folder.join(format!("{REPORT}.bad"))).unwrap(),
        "earlier evidence",
        "an existing .bad must stay as it is"
    );
    f.assert_untouched();
}

#[test]
fn a_stale_part_file_is_replaced_when_exported_to_is_written() {
    let f = Fixture::new("stale-part", Some("verified"), Some(good_dump().as_slice()));
    let part = f.pg_root.join("exported-to.json.part");
    fs::write(&part, "stale half-written junk").unwrap();
    record_exported_to(&f.pg_root, &f.folder).expect("record must succeed");
    assert!(!part.exists(), "the stale .part must not survive the write");
    let text = fs::read_to_string(f.pg_root.join("exported-to.json")).unwrap();
    let value: serde_json::Value = serde_json::from_str(&text).unwrap();
    assert_eq!(value["folder"], canonical(&f.folder));
}
