//! Tests for the one-click update state rules. The pure parts are tested here;
//! the Tauri wiring is covered by the web tests with a mocked shell API.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use weaveforge_shell_lib::app_update::{
    AppUpdateStatus, CHECK_FAILED, INSTALL_FAILED, LocalData, Phase, UPDATE_HELD, can_check,
    can_install, classify_local, configured, install_allowed, local_data_in,
    native_database_present, percent,
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
            "https://github.com/Satwik-Miyyapuram/weaveforge/releases/latest/download/latest-v2.json"
        ])
    );
    assert_eq!(updater["windows"]["installMode"], "passive");
}

#[test]
fn verified_local_data_lets_0_9_7_move_to_a_newer_release() {
    assert!(install_allowed("0.9.7", "0.9.8", LocalData::Verified).is_ok());
}

#[test]
fn no_local_db_lets_0_9_7_move_to_a_newer_release() {
    assert!(install_allowed("0.9.7", "0.9.8", LocalData::None).is_ok());
}

#[test]
fn unexported_local_data_holds_0_9_7_back_from_a_newer_release() {
    let message = install_allowed("0.9.7", "0.9.8", LocalData::Unverified).unwrap_err();
    assert!(message.contains("0.9.8"), "{message}");
    assert!(message.contains("export"), "{message}");
}

#[test]
fn releases_older_than_0_9_7_cannot_jump_past_the_bridge() {
    let message = install_allowed("0.9.6", "0.9.8", LocalData::None).unwrap_err();
    assert!(message.contains("0.9.7"), "{message}");
    assert!(install_allowed("0.9.6", "0.9.7", LocalData::None).is_ok());
    assert!(install_allowed("0.9.5", "0.9.8", LocalData::Verified).is_err());
}

#[test]
fn held_install_message_is_plain_and_names_the_bridge_and_the_export() {
    assert!(UPDATE_HELD.contains("0.9.7"));
    assert!(UPDATE_HELD.contains("export"));
    assert!(!UPDATE_HELD.contains("install_allowed"));
    assert!(UPDATE_HELD.ends_with('.'));
}

#[test]
fn a_verified_native_database_lets_0_9_7_move_on() {
    let local = classify_local(true, true, false, false);
    assert_eq!(local, LocalData::Verified);
    assert!(install_allowed("0.9.7", "0.9.8", local).is_ok());
}

#[test]
fn an_unverified_native_database_holds_0_9_7_back() {
    let local = classify_local(true, false, false, false);
    assert_eq!(local, LocalData::Unverified);
    let message = install_allowed("0.9.7", "0.9.8", local).unwrap_err();
    assert!(message.contains("export"), "{message}");
}

#[test]
fn every_present_database_must_be_verified() {
    assert_eq!(
        classify_local(true, true, true, false),
        LocalData::Unverified
    );
    assert_eq!(classify_local(false, false, false, false), LocalData::None);
}

#[test]
fn no_local_database_allows_the_held_release_without_a_device_id() {
    // With no old or native database there is nothing to export, so the device check
    // (which needs a device id) never applies and the 0.9.8 install goes through.
    let local = classify_local(false, false, false, false);
    assert_eq!(local, LocalData::None);
    assert!(install_allowed("0.9.7", "0.9.8", local).is_ok());
    assert!(install_allowed("0.9.6", "1.0.0", local).is_err());
}

#[test]
fn a_pre_release_of_0_9_7_counts_as_the_bridge() {
    assert!(install_allowed("0.9.7-rc1", "0.9.8", LocalData::None).is_ok());
    assert!(install_allowed("0.9.7-rc1", "0.9.8", LocalData::Verified).is_ok());
    assert!(install_allowed("0.9.7-rc1", "0.9.8", LocalData::Unverified).is_err());
    assert!(install_allowed("0.9.7-rc1", "0.9.6", LocalData::Unverified).is_ok());
}

#[test]
fn a_pre_release_offer_above_0_9_7_is_held_like_a_release() {
    assert!(install_allowed("0.9.7", "0.9.8-rc1", LocalData::Unverified).is_err());
    assert!(install_allowed("0.9.7", "0.9.8-rc1", LocalData::Verified).is_ok());
}

#[test]
fn a_same_version_offer_is_not_held() {
    assert!(install_allowed("0.9.7", "0.9.7", LocalData::Unverified).is_ok());
}

#[test]
fn a_held_release_can_be_checked_and_installed_again() {
    // The install re-runs the gate, so a held offer may proceed once local data is verified.
    assert!(can_check(Phase::Held));
    assert!(can_install(Phase::Held));
}

#[test]
fn native_data_counts_only_with_a_pg_version_file() {
    let dir = std::env::temp_dir().join(format!("wf-native-{}-{}", std::process::id(), line!()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    assert!(!native_database_present(&dir));
    std::fs::write(dir.join("stray.txt"), "x").unwrap();
    assert!(!native_database_present(&dir));
    std::fs::write(dir.join("PG_VERSION"), "16").unwrap();
    assert!(native_database_present(&dir));
    assert!(!native_database_present(&dir.join("missing")));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn an_unresolvable_data_folder_is_unverified_so_the_update_is_held() {
    assert_eq!(local_data_in(None), LocalData::Unverified);
}

#[test]
fn a_verified_report_from_another_device_holds_0_9_7_back() {
    // The export was verified, but by another machine. This device's data is still unexported.
    let root = std::env::temp_dir().join(format!("wf-other-device-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    let data = root.join("data");
    let ws = root.join("ws");
    let pg = data.join("local-pg");
    let report_dir = ws.join(".weaveforge").join("migration-0.9.7");
    std::fs::create_dir_all(&pg).unwrap();
    std::fs::create_dir_all(&report_dir).unwrap();
    std::fs::write(pg.join("PG_VERSION"), "16").unwrap();
    std::fs::write(
        pg.join("exported-to.json"),
        format!(
            r#"{{"folder":"{}"}}"#,
            ws.display().to_string().replace('\\', "\\\\")
        ),
    )
    .unwrap();
    let other = "f".repeat(64);
    std::fs::write(
        report_dir.join("report.json"),
        format!(r#"{{"state":"verified","runs":[{{"deviceId":"{other}","missing":[]}}]}}"#),
    )
    .unwrap();
    let mine = weaveforge_shell_lib::device_id::get_or_create(&data).unwrap();
    assert_ne!(mine, other);
    assert!(!weaveforge_shell_lib::migrate::native_data_verified(
        &pg,
        Some(&mine)
    ));
    let local = local_data_in(Some(&data));
    assert_eq!(local, LocalData::Unverified);
    assert!(install_allowed("0.9.7", "0.9.8", local).is_err());
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn a_missing_device_id_is_not_written_and_holds_the_update() {
    // Legacy data is exported, but this data folder has no device-id file yet. The gate must
    // hold the update without creating one: a check that writes is not a read-only check.
    let root = std::env::temp_dir().join(format!("wf-no-device-id-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    let data = root.join("data");
    let ws = root.join("ws");
    let pg = data.join("local-pg");
    std::fs::create_dir_all(&pg).unwrap();
    std::fs::write(pg.join("PG_VERSION"), "16").unwrap();
    std::fs::write(
        pg.join("exported-to.json"),
        format!(
            r#"{{"folder":"{}"}}"#,
            ws.display().to_string().replace('\\', "\\\\")
        ),
    )
    .unwrap();
    let local = local_data_in(Some(&data));
    assert_eq!(local, LocalData::Unverified);
    assert!(install_allowed("0.9.7", "0.9.8", local).is_err());
    assert!(
        !data.join("device-id").exists(),
        "the check wrote a device id"
    );
    let _ = std::fs::remove_dir_all(&root);
}
