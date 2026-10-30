#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, missing_docs)]
//! Preferences file: the rules `prefs.rs` promises, against a real folder.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::thread;

use serde_json::{Value, json};
use weaveforge_shell::commands::ShellError;
use weaveforge_shell::prefs::{PAGE_WRITABLE, PREFERENCE_NAMES, PrefError, PrefValue, Prefs};

static NEXT_DIR: AtomicU64 = AtomicU64::new(0);

/// A fresh folder for one test, removed when the test ends.
struct TestDir(PathBuf);

impl TestDir {
    fn new() -> Self {
        let n = NEXT_DIR.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!("wf-prefs-test-{}-{n}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        Self(dir)
    }

    fn path(&self) -> &Path {
        &self.0
    }

    fn file(&self) -> PathBuf {
        self.0.join("preferences.json")
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn json_of(file: &Path) -> Value {
    serde_json::from_str(&fs::read_to_string(file).unwrap()).unwrap()
}

fn names_in(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(dir)
        .unwrap()
        .map(|e| e.unwrap().file_name().into_string().unwrap())
        .collect();
    names.sort();
    names
}

fn text(s: &str) -> Option<PrefValue> {
    Some(PrefValue::Text(s.to_owned()))
}

#[test]
fn unset_reads_none_and_read_creates_no_file() {
    let dir = TestDir::new();
    let prefs = Prefs::new(dir.file());
    assert_eq!(prefs.read("sync-target").unwrap(), None);
    assert!(!dir.file().exists());
}

#[test]
fn written_values_read_back() {
    let dir = TestDir::new();
    let prefs = Prefs::new(dir.file());
    prefs.write("sync-target", text("https://s")).unwrap();
    assert_eq!(
        prefs.read("sync-target").unwrap(),
        Some(PrefValue::Text("https://s".to_owned()))
    );
    prefs
        .write("vault-git", Some(PrefValue::Flag(true)))
        .unwrap();
    assert_eq!(
        prefs.read("vault-git").unwrap(),
        Some(PrefValue::Flag(true))
    );
    prefs
        .write("vault-git", Some(PrefValue::Flag(false)))
        .unwrap();
    assert_eq!(
        prefs.read("vault-git").unwrap(),
        Some(PrefValue::Flag(false))
    );
}

#[test]
fn every_name_round_trips_text() {
    let dir = TestDir::new();
    let prefs = Prefs::new(dir.file());
    for name in PREFERENCE_NAMES {
        prefs.write(name, text(&format!("v-{name}"))).unwrap();
    }
    for name in PREFERENCE_NAMES {
        assert_eq!(
            prefs.read(name).unwrap(),
            Some(PrefValue::Text(format!("v-{name}")))
        );
    }
}

#[test]
fn writing_none_forgets_the_key() {
    let dir = TestDir::new();
    let prefs = Prefs::new(dir.file());
    prefs.write("sync-target", text("https://s")).unwrap();
    prefs.write("sync-target", None).unwrap();
    assert_eq!(prefs.read("sync-target").unwrap(), None);
    let parsed = json_of(&dir.file());
    assert!(!parsed.as_object().unwrap().contains_key("sync-target"));
    assert_eq!(parsed, json!({}));
}

#[test]
fn unknown_names_are_refused_and_create_no_file() {
    let dir = TestDir::new();
    let prefs = Prefs::new(dir.file());
    for name in [
        "sync-offer-shown",
        "",
        "__proto__",
        "VAULT-GIT",
        " vault-git",
    ] {
        assert_eq!(prefs.read(name), Err(PrefError::UnknownName));
        assert_eq!(
            prefs.write(name, Some(PrefValue::Flag(true))),
            Err(PrefError::UnknownName)
        );
    }
    assert!(!dir.file().exists());
}

#[test]
fn corrupt_contents_read_none_and_a_write_starts_over() {
    for contents in ["{not json", "", "   ", "[1,2]", "42", "null", "\"s\""] {
        let dir = TestDir::new();
        fs::write(dir.file(), contents).unwrap();
        let prefs = Prefs::new(dir.file());
        assert_eq!(
            prefs.read("vault-git").unwrap(),
            None,
            "contents {contents:?}"
        );
        prefs
            .write("vault-git", Some(PrefValue::Flag(true)))
            .unwrap();
        assert_eq!(json_of(&dir.file()), json!({"vault-git": true}));
    }
}

#[test]
fn unexpected_shape_on_file_reads_none() {
    for raw in ["1", "null", "[]", "{}"] {
        let dir = TestDir::new();
        fs::write(dir.file(), format!("{{\"vault-git\": {raw}}}")).unwrap();
        let prefs = Prefs::new(dir.file());
        assert_eq!(prefs.read("vault-git").unwrap(), None, "shape {raw}");
    }
}

#[test]
fn write_keeps_other_keys_including_unknown_ones() {
    let dir = TestDir::new();
    fs::write(
        dir.file(),
        r#"{"sync-offer-shown":true,"vault-git":true,"sync-target":"https://s","zzz":{"a":1}}"#,
    )
    .unwrap();
    let prefs = Prefs::new(dir.file());
    prefs
        .write("vault-git", Some(PrefValue::Flag(false)))
        .unwrap();
    assert_eq!(
        json_of(&dir.file()),
        json!({
            "sync-offer-shown": true,
            "vault-git": false,
            "sync-target": "https://s",
            "zzz": {"a": 1}
        })
    );
}

#[test]
fn file_is_pretty_json_with_one_trailing_newline() {
    let dir = TestDir::new();
    let prefs = Prefs::new(dir.file());
    prefs.write("sync-target", text("https://s")).unwrap();
    assert_eq!(
        fs::read_to_string(dir.file()).unwrap(),
        "{\n  \"sync-target\": \"https://s\"\n}\n"
    );
}

#[test]
fn missing_folder_is_created() {
    let dir = TestDir::new();
    let file = dir
        .path()
        .join("nested")
        .join("deeper")
        .join("preferences.json");
    let prefs = Prefs::new(file.clone());
    prefs
        .write("vault-git", Some(PrefValue::Flag(true)))
        .unwrap();
    assert!(file.is_file());
    assert_eq!(json_of(&file), json!({"vault-git": true}));
}

/// Eight threads, each writing its own name 20 times through a clone of one `Prefs`.
fn concurrent_writes(prefs: &Prefs) -> Vec<&'static str> {
    let names: Vec<&'static str> = PREFERENCE_NAMES.iter().copied().take(8).collect();
    let handles: Vec<_> = names
        .iter()
        .copied()
        .enumerate()
        .map(|(i, name)| {
            let prefs = prefs.clone();
            thread::spawn(move || {
                for round in 0..20 {
                    prefs
                        .write(name, Some(PrefValue::Text(format!("{i}-{round}"))))
                        .unwrap();
                }
            })
        })
        .collect();
    for handle in handles {
        handle.join().unwrap();
    }
    names
}

#[test]
fn concurrent_writes_each_keep_their_last_value() {
    let dir = TestDir::new();
    let prefs = Prefs::new(dir.file());
    let names = concurrent_writes(&prefs);
    for (i, name) in names.iter().enumerate() {
        assert_eq!(
            prefs.read(name).unwrap(),
            Some(PrefValue::Text(format!("{i}-19"))),
            "name {name}"
        );
    }
}

#[test]
fn no_draft_is_left_behind() {
    let dir = TestDir::new();
    let prefs = Prefs::new(dir.file());
    let _ = concurrent_writes(&prefs);
    assert_eq!(names_in(dir.path()), vec!["preferences.json".to_owned()]);

    let blocked = TestDir::new();
    fs::write(blocked.path().join("blocked"), "x").unwrap();
    let failing = Prefs::new(blocked.path().join("blocked").join("preferences.json"));
    assert_eq!(
        failing.write("vault-git", Some(PrefValue::Flag(true))),
        Err(PrefError::Unsaved)
    );
    assert_eq!(names_in(blocked.path()), vec!["blocked".to_owned()]);
}

#[test]
fn unreadable_file_reads_none_and_write_is_refused() {
    let dir = TestDir::new();
    fs::create_dir(dir.file()).unwrap();
    let prefs = Prefs::new(dir.file());
    assert_eq!(prefs.read("vault-git").unwrap(), None);
    assert_eq!(
        prefs.write("vault-git", Some(PrefValue::Flag(true))),
        Err(PrefError::Unreadable)
    );
    assert!(dir.file().is_dir());
    assert_eq!(names_in(dir.path()), vec!["preferences.json".to_owned()]);
}

#[test]
fn failed_save_is_reported_and_the_same_prefs_works_after_repair() {
    let dir = TestDir::new();
    fs::write(dir.path().join("blocked"), "x").unwrap();
    let prefs = Prefs::new(dir.path().join("blocked").join("preferences.json"));
    assert_eq!(
        prefs.write("vault-git", Some(PrefValue::Flag(true))),
        Err(PrefError::Unsaved)
    );
    fs::remove_file(dir.path().join("blocked")).unwrap();
    assert_eq!(
        prefs.write("vault-git", Some(PrefValue::Flag(true))),
        Ok(())
    );
    assert_eq!(
        prefs.read("vault-git").unwrap(),
        Some(PrefValue::Flag(true))
    );
}

#[test]
fn page_write_stores_and_removes_page_writable_names() {
    let dir = TestDir::new();
    let prefs = Prefs::new(dir.file());
    for name in ["vault-git", "vault-git-remote"] {
        prefs.page_write(name, text("x")).unwrap();
        assert_eq!(
            prefs.read(name).unwrap(),
            Some(PrefValue::Text("x".to_owned()))
        );
        prefs.page_write(name, None).unwrap();
        assert_eq!(prefs.read(name).unwrap(), None);
    }
}

#[test]
fn page_write_refuses_other_known_names_and_leaves_file_unchanged() {
    let dir = TestDir::new();
    let prefs = Prefs::new(dir.file());
    prefs.write("sync-target", text("https://s")).unwrap();
    let before = fs::read_to_string(dir.file()).unwrap();
    for name in PREFERENCE_NAMES
        .iter()
        .copied()
        .filter(|n| !PAGE_WRITABLE.contains(n))
    {
        assert_eq!(
            prefs.page_write(name, Some(PrefValue::Flag(true))),
            Err(PrefError::UnknownName),
            "name {name}"
        );
    }
    assert_eq!(fs::read_to_string(dir.file()).unwrap(), before);
}

#[test]
fn page_write_refuses_unknown_names() {
    let dir = TestDir::new();
    let prefs = Prefs::new(dir.file());
    for name in [
        "sync-offer-shown",
        "",
        "__proto__",
        "VAULT-GIT",
        " vault-git",
    ] {
        assert_eq!(
            prefs.page_write(name, Some(PrefValue::Flag(true))),
            Err(PrefError::UnknownName)
        );
    }
    assert!(!dir.file().exists());
}

#[test]
fn page_writable_matches_the_web_bridge_type() {
    for name in PAGE_WRITABLE {
        assert!(PREFERENCE_NAMES.contains(&name));
    }
    let mut seen = HashSet::new();
    for name in PREFERENCE_NAMES {
        assert!(seen.insert(name), "duplicate {name}");
    }
    const BRIDGE: &str = include_str!("../../web/src/lib/desktop/desktop-bridge.ts");
    let line = BRIDGE
        .lines()
        .find(|l| l.starts_with("export type DesktopPreferenceName ="))
        .unwrap();
    let quoted: Vec<&str> = line.split('"').skip(1).step_by(2).collect();
    assert_eq!(quoted, PAGE_WRITABLE.to_vec());
}

#[test]
fn pref_value_serde_shapes() {
    assert_eq!(
        serde_json::to_value(PrefValue::Text("x".to_owned())).unwrap(),
        json!("x")
    );
    assert_eq!(
        serde_json::to_value(PrefValue::Flag(true)).unwrap(),
        json!(true)
    );
    assert_eq!(
        serde_json::to_value(Option::<PrefValue>::None).unwrap(),
        json!(null)
    );
    assert_eq!(
        serde_json::from_value::<PrefValue>(json!("x")).unwrap(),
        PrefValue::Text("x".to_owned())
    );
    assert_eq!(
        serde_json::from_value::<PrefValue>(json!(true)).unwrap(),
        PrefValue::Flag(true)
    );
    assert_eq!(
        serde_json::from_value::<Option<PrefValue>>(json!(null)).unwrap(),
        None
    );
    assert!(serde_json::from_str::<PrefValue>("1").is_err());
}

#[test]
fn pref_error_texts_are_exact() {
    assert_eq!(
        PrefError::UnknownName.to_string(),
        "That is not something this app remembers."
    );
    assert_eq!(
        PrefError::Unreadable.to_string(),
        "The preferences file could not be read just now, so nothing was changed."
    );
    assert_eq!(
        PrefError::Unsaved.to_string(),
        "The preferences file could not be saved just now, so nothing was changed."
    );
    assert_eq!(
        PrefError::BadValue.to_string(),
        "A preference is a string, a boolean, or nothing."
    );
    const DESKTOP: &str = include_str!("../../desktop/src/preference-store.ts");
    assert!(DESKTOP.contains(&PrefError::UnknownName.to_string()));
    assert!(DESKTOP.contains(&PrefError::Unreadable.to_string()));
    assert!(DESKTOP.contains(&PrefError::BadValue.to_string()));
}

#[test]
fn non_utf8_file_reads_none_and_a_write_replaces_it() {
    let dir = TestDir::new();
    fs::write(dir.file(), b"\xff\xfe{").unwrap();
    let prefs = Prefs::new(dir.file());
    assert_eq!(prefs.read("vault-git").unwrap(), None);
    assert_eq!(
        prefs.write("vault-git", Some(PrefValue::Flag(true))),
        Ok(())
    );
    assert_eq!(json_of(&dir.file()), json!({"vault-git": true}));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_later_write_wins_even_when_neither_is_awaited() {
    let dir = TestDir::new();
    let prefs = Prefs::new(dir.file());
    for round in 0..100 {
        let write_true = prefs.queued(|p| p.page_write("vault-git", Some(PrefValue::Flag(true))));
        let write_false = prefs.queued(|p| p.page_write("vault-git", Some(PrefValue::Flag(false))));
        let (a, b) = tokio::join!(write_true, write_false);
        assert_eq!(a, Ok(()), "round {round}");
        assert_eq!(b, Ok(()), "round {round}");
        assert_eq!(
            prefs.read("vault-git").unwrap(),
            Some(PrefValue::Flag(false)),
            "round {round}"
        );
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn queued_returns_the_work_result_and_its_error() {
    let dir = TestDir::new();
    let prefs = Prefs::new(dir.file());
    assert_eq!(prefs.queued(|_| Ok(7)).await, Ok(7));
    assert_eq!(
        prefs.queued(|p| p.page_write("sync-target", None)).await,
        Err(PrefError::UnknownName)
    );
}

#[test]
fn page_write_json_maps_json_values() {
    let dir = TestDir::new();
    let prefs = Prefs::new(dir.file());
    assert_eq!(
        prefs.page_write_json("vault-git-remote", json!("https://x")),
        Ok(())
    );
    assert_eq!(
        prefs.read("vault-git-remote").unwrap(),
        Some(PrefValue::Text("https://x".to_owned()))
    );
    assert_eq!(prefs.page_write_json("vault-git", json!(true)), Ok(()));
    assert_eq!(
        prefs.read("vault-git").unwrap(),
        Some(PrefValue::Flag(true))
    );
    assert_eq!(prefs.page_write_json("vault-git", Value::Null), Ok(()));
    assert_eq!(prefs.read("vault-git").unwrap(), None);

    prefs.page_write_json("vault-git", json!(true)).unwrap();
    let before = fs::read(dir.file()).unwrap();
    for value in [json!(1), json!(1.5), json!([]), json!({})] {
        assert_eq!(
            prefs.page_write_json("vault-git", value.clone()),
            Err(PrefError::BadValue),
            "value {value}"
        );
        assert_eq!(fs::read(dir.file()).unwrap(), before, "value {value}");
    }

    assert_eq!(
        prefs.page_write_json("sync-target", json!(1)),
        Err(PrefError::UnknownName)
    );
    assert_eq!(
        prefs.page_write_json("nope", json!(true)),
        Err(PrefError::UnknownName)
    );
}

#[test]
fn shell_error_carries_the_pref_error_text() {
    assert_eq!(
        ShellError::from(PrefError::UnknownName).message,
        "That is not something this app remembers."
    );
}
