#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, missing_docs)]
//! Tests for the local database commands' types and the generated TypeScript bindings.

use std::path::PathBuf;

use serde_json::json;
use weaveforge_shell_lib::commands::{DbState, Json, LocalDb, ShellError, export_bindings};

#[tokio::test]
async fn a_database_that_failed_to_start_says_why() {
    let db = LocalDb::new(Err("no postgres".to_owned()), "/d".to_owned());
    let failed = Err(ShellError {
        message: "no postgres".to_owned(),
    });
    assert_eq!(db.query("select 1".to_owned(), Vec::new()).await, failed);
    assert_eq!(db.state().failure.as_deref(), Some("no postgres"));
}

#[test]
fn db_state_is_camel_case() {
    let state = DbState {
        failure: None,
        data_dir: "/x".into(),
        restored_from: None,
    };
    assert_eq!(
        serde_json::to_value(state).unwrap(),
        json!({"failure": null, "dataDir": "/x", "restoredFrom": null})
    );
    let parsed: DbState = serde_json::from_value(json!({"failure": "f", "dataDir": "/y"})).unwrap();
    assert_eq!(parsed.restored_from, None);
}

#[test]
fn json_wrapper_round_trips() {
    let input = json!({"$bigint": "9007199254740993"});
    let it: Json = serde_json::from_value(input.clone()).unwrap();
    assert_eq!(serde_json::to_value(&it).unwrap(), input);
}

#[test]
fn bindings_are_fresh() {
    let want = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("bridge/bindings.ts");
    let tmp = std::env::temp_dir().join(format!("wf-bindings-{}.ts", std::process::id()));
    export_bindings(&tmp).unwrap();
    let generated = std::fs::read_to_string(&tmp).unwrap();
    std::fs::remove_file(&tmp).unwrap();

    if std::env::var("WF_UPDATE_BINDINGS").as_deref() == Ok("1") {
        std::fs::create_dir_all(want.parent().unwrap()).unwrap();
        std::fs::write(&want, &generated).unwrap();
        return;
    }
    let committed = std::fs::read_to_string(&want).unwrap();
    assert_eq!(
        committed.replace("\r\n", "\n"),
        generated.replace("\r\n", "\n"),
        "bridge/bindings.ts is stale: run WF_UPDATE_BINDINGS=1 cargo test --test shell commands::"
    );
}
