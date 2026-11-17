//! Tests for `settings::workspace_settings`: the id and tier fields of `.weaveforge/settings.json`.
//! A file this module cannot read is refused, never rewritten; fields it does not own survive.

#![allow(clippy::panic, clippy::expect_used)]

use wf_core::settings::workspace_settings::{SettingsError, WorkspaceSettings};
use wf_core::sync::tier_merge::Tier;

#[test]
fn an_empty_object_reads_as_a_local_folder_with_no_id() {
    let settings = WorkspaceSettings::parse("{}").expect("parse");
    assert_eq!(settings.tier.workspace_id, None);
    assert_eq!(settings.tier.tier, Tier::Local);
    assert_eq!(settings.tier.tier_epoch, 0);
    assert_eq!(settings.tier.tier_account, None);
    assert_eq!(settings.server_hint, None);
}

#[test]
fn every_tier_field_round_trips_and_unknown_fields_are_kept() {
    let text = r#"{
  "feedId": "feed-1",
  "pins": [1, 2],
  "workspaceId": "0c6f2a1e-7d3b-4f1a-9a2e-000000000001",
  "tier": "sharing",
  "tierEpoch": 3,
  "tierAccount": "user-7",
  "serverHint": "weaveforge.org"
}"#;
    let settings = WorkspaceSettings::parse(text).expect("parse");
    assert_eq!(
        settings.tier.workspace_id.as_deref(),
        Some("0c6f2a1e-7d3b-4f1a-9a2e-000000000001")
    );
    assert_eq!(settings.tier.tier, Tier::Sharing);
    assert_eq!(settings.tier.tier_epoch, 3);
    assert_eq!(settings.tier.tier_account.as_deref(), Some("user-7"));
    assert_eq!(settings.server_hint.as_deref(), Some("weaveforge.org"));

    let rewritten = settings.to_text().expect("to_text");
    let again = WorkspaceSettings::parse(&rewritten).expect("parse rewritten");
    assert_eq!(again, settings);
    assert!(rewritten.contains("\"feedId\": \"feed-1\""));
    assert!(rewritten.contains("\"pins\""));
}

#[test]
fn local_tier_writes_as_local_and_local_web_has_its_own_name() {
    let text = r#"{"tier": "local-web", "tierEpoch": 1}"#;
    let settings = WorkspaceSettings::parse(text).expect("parse");
    assert_eq!(settings.tier.tier, Tier::LocalWeb);
    let rewritten = settings.to_text().expect("to_text");
    assert!(rewritten.contains("\"tier\": \"local-web\""));
}

#[test]
fn a_folder_with_no_id_is_stamped_once() {
    let mut settings = WorkspaceSettings::parse("{}").expect("parse");
    assert!(settings.ensure_workspace_id("first-id"));
    assert_eq!(settings.tier.workspace_id.as_deref(), Some("first-id"));
    assert!(!settings.ensure_workspace_id("second-id"));
    assert_eq!(settings.tier.workspace_id.as_deref(), Some("first-id"));
}

#[test]
fn a_stored_id_wins_over_a_fresh_one() {
    let mut settings = WorkspaceSettings::parse(r#"{"workspaceId": "kept"}"#).expect("parse");
    assert!(!settings.ensure_workspace_id("fresh"));
    assert_eq!(settings.tier.workspace_id.as_deref(), Some("kept"));
}

#[test]
fn an_empty_stored_id_counts_as_no_id() {
    let mut settings = WorkspaceSettings::parse(r#"{"workspaceId": ""}"#).expect("parse");
    assert_eq!(settings.tier.workspace_id, None);
    assert!(settings.ensure_workspace_id("fresh"));
    assert_eq!(settings.tier.workspace_id.as_deref(), Some("fresh"));
}

#[test]
fn a_new_folder_has_no_id_until_stamped() {
    let mut settings = WorkspaceSettings::new_folder();
    assert_eq!(settings.tier.workspace_id, None);
    assert!(settings.ensure_workspace_id("new-id"));
    let rewritten = settings.to_text().expect("to_text");
    let back = WorkspaceSettings::parse(&rewritten).expect("parse");
    assert_eq!(back.tier.workspace_id.as_deref(), Some("new-id"));
}

#[test]
fn text_that_is_not_json_is_refused() {
    assert_eq!(WorkspaceSettings::parse("{"), Err(SettingsError::Malformed));
}

#[test]
fn json_that_is_not_an_object_is_refused() {
    assert_eq!(
        WorkspaceSettings::parse("[]"),
        Err(SettingsError::Malformed)
    );
    assert_eq!(
        WorkspaceSettings::parse("\"sharing\""),
        Err(SettingsError::Malformed)
    );
}

#[test]
fn an_unknown_tier_is_refused_rather_than_read_as_local() {
    assert_eq!(
        WorkspaceSettings::parse(r#"{"tier": "public"}"#),
        Err(SettingsError::BadField("tier"))
    );
}

#[test]
fn a_bad_epoch_is_refused() {
    assert_eq!(
        WorkspaceSettings::parse(r#"{"tierEpoch": "3"}"#),
        Err(SettingsError::BadField("tierEpoch"))
    );
    assert_eq!(
        WorkspaceSettings::parse(r#"{"tierEpoch": -1}"#),
        Err(SettingsError::BadField("tierEpoch"))
    );
}

#[test]
fn a_non_string_id_is_refused() {
    assert_eq!(
        WorkspaceSettings::parse(r#"{"workspaceId": 5}"#),
        Err(SettingsError::BadField("workspaceId"))
    );
}
