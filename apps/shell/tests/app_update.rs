//! Tests for the one-click update state rules. The pure parts are tested here;
//! the Tauri wiring is covered by the web tests with a mocked shell API.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use weaveforge_shell_lib::app_update::{
    AppUpdateStatus, CHECK_FAILED, INSTALL_FAILED, Phase, can_check, can_install, configured,
    percent,
};

#[test]
fn an_empty_or_blank_key_is_not_configured() {
    assert!(!configured(""));
    assert!(!configured("   \n"));
}

#[test]
fn a_real_key_is_configured() {
    assert!(configured(
        "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmtleQ=="
    ));
}

#[test]
fn progress_is_a_whole_percent() {
    assert_eq!(percent(0, Some(100)), Some(0));
    assert_eq!(percent(50, Some(200)), Some(25));
    assert_eq!(percent(199, Some(200)), Some(99));
}

#[test]
fn progress_is_capped_at_100() {
    assert_eq!(percent(200, Some(100)), Some(100));
    assert_eq!(percent(u64::MAX, Some(1)), Some(100));
}

#[test]
fn progress_is_unknown_without_a_size() {
    assert_eq!(percent(5, None), None);
    assert_eq!(percent(5, Some(0)), None);
}

#[test]
fn checks_run_from_every_resting_phase() {
    for phase in [
        Phase::Idle,
        Phase::UpToDate,
        Phase::Available,
        Phase::Failed,
    ] {
        assert!(can_check(phase), "{phase:?} should allow a check");
    }
}

#[test]
fn no_check_starts_while_busy_or_unsupported() {
    for phase in [
        Phase::Checking,
        Phase::Downloading,
        Phase::Installing,
        Phase::Unsupported,
    ] {
        assert!(!can_check(phase), "{phase:?} must not allow a check");
    }
}

#[test]
fn install_needs_an_offer_or_a_retry() {
    assert!(can_install(Phase::Available));
    assert!(can_install(Phase::Failed));
    for phase in [
        Phase::Unsupported,
        Phase::Idle,
        Phase::Checking,
        Phase::UpToDate,
        Phase::Downloading,
        Phase::Installing,
    ] {
        assert!(!can_install(phase), "{phase:?} must not allow an install");
    }
}

#[test]
fn phases_and_status_serialize_for_the_page() {
    assert_eq!(
        serde_json::to_string(&Phase::UpToDate).unwrap(),
        "\"upToDate\""
    );
    let status = AppUpdateStatus {
        phase: Phase::Available,
        current: "0.9.1".into(),
        version: Some("0.9.2".into()),
        percent: None,
        error: None,
    };
    let json = serde_json::to_value(&status).unwrap();
    assert_eq!(json["phase"], "available");
    assert_eq!(json["current"], "0.9.1");
    assert_eq!(json["version"], "0.9.2");
    assert!(json["percent"].is_null());
}

#[test]
fn failure_messages_never_read_as_up_to_date() {
    assert!(CHECK_FAILED.contains("Could not"));
    assert!(INSTALL_FAILED.contains("Try again"));
}

const TAURI_CONF: &str = include_str!("../tauri.conf.json");
const BRIDGE: &str = include_str!("../../web/src/lib/desktop/desktop-bridge.ts");

/// Each phase serializes to the name the page's `DesktopAppUpdatePhase` union uses.
#[test]
fn every_phase_has_the_name_the_page_union_lists() {
    let names = [
        (Phase::Unsupported, "unsupported"),
        (Phase::Idle, "idle"),
        (Phase::Checking, "checking"),
        (Phase::UpToDate, "upToDate"),
        (Phase::Available, "available"),
        (Phase::Downloading, "downloading"),
        (Phase::Installing, "installing"),
        (Phase::Failed, "failed"),
    ];
    for (phase, name) in names {
        assert_eq!(serde_json::to_value(phase).unwrap(), name);
        assert!(
            BRIDGE.contains(&format!("\"{name}\"")),
            "desktop-bridge.ts lacks {name}"
        );
    }
}

/// The updater is on: a real key to verify with, the release manifest as the only
/// endpoint, and a passive installer on Windows. Dropping any of these silently
/// turns the one-click update off.
#[test]
fn the_updater_is_configured_with_a_key_and_the_release_manifest() {
    let conf: serde_json::Value = serde_json::from_str(TAURI_CONF).unwrap();
    let updater = &conf["plugins"]["updater"];
    assert!(configured(updater["pubkey"].as_str().unwrap_or_default()));
    assert_eq!(
        updater["endpoints"],
        serde_json::json!([
            "https://github.com/Satwik-Miyyapuram/weaveforge/releases/latest/download/latest.json"
        ])
    );
    assert_eq!(updater["windows"]["installMode"], "passive");
}
