#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, missing_docs)]
//! Tests for the shell command types and the generated TypeScript bindings.

use std::path::PathBuf;

use serde_json::json;
use weaveforge_shell_lib::commands::{Json, ShellError, export_bindings};

#[test]
fn a_coded_error_sends_its_code_and_a_plain_one_sends_none() {
    assert_eq!(
        serde_json::to_value(ShellError::coded("NOT_LOADED", "gone")).unwrap(),
        json!({"message": "gone", "code": "NOT_LOADED"})
    );
    assert_eq!(
        serde_json::to_value(ShellError::from("plain".to_owned())).unwrap(),
        json!({"message": "plain"})
    );
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

#[test]
fn a_098_shell_exposes_the_legacy_gate_commands() {
    let text = std::fs::read_to_string(
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("bridge/bindings.ts"),
    )
    .unwrap();
    assert!(
        text.contains("legacyDbPresent:"),
        "bindings lack legacyDbPresent"
    );
    assert!(
        text.contains("migrationReportVerified:"),
        "bindings lack migrationReportVerified"
    );
    assert!(
        text.contains("installGateRequired:"),
        "bindings lack installGateRequired"
    );
    assert!(
        !text.contains("migrate093Run:"),
        "migrate093Run must be gone"
    );
    assert!(text.contains("pickFolder:"), "bindings lack pickFolder");
}
