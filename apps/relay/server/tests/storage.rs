//! Blob storage settings read from the environment: tiers, R2 and cold targets, view secret.
#![allow(clippy::unwrap_used, clippy::expect_used, missing_docs)]

use std::collections::HashMap;

use wf_relay_server::s3::S3Target;
use wf_relay_server::storage::StorageConfig;

const R2_MISSING_ALL: &str = "Tiered storage is not configured: missing R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET.";

const R2: &[(&str, &str)] = &[
    ("R2_ACCOUNT_ID", "acc"),
    ("R2_ACCESS_KEY_ID", "AK"),
    ("R2_SECRET_ACCESS_KEY", "SK"),
    ("R2_BUCKET", "blobs"),
];

const COLD: &[(&str, &str)] = &[
    ("BLOB_COLD_ENDPOINT", "https://cold.example.com/"),
    ("BLOB_COLD_ACCESS_KEY_ID", "CAK"),
    ("BLOB_COLD_SECRET_ACCESS_KEY", "CSK"),
    ("BLOB_COLD_BUCKET", "cold-blobs"),
];

/// Builds an env lookup from the given name/value groups.
fn env_of(parts: &[&[(&str, &str)]]) -> impl Fn(&str) -> Option<String> {
    let map: HashMap<String, String> = parts
        .iter()
        .flat_map(|p| p.iter())
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();
    move |name: &str| map.get(name).cloned()
}

fn hot_target() -> S3Target {
    S3Target {
        endpoint: "https://acc.r2.cloudflarestorage.com".into(),
        region: "auto".into(),
        bucket: "blobs".into(),
        access_key_id: "AK".into(),
        secret_access_key: "SK".into(),
    }
}

fn cold_target() -> S3Target {
    S3Target {
        endpoint: "https://cold.example.com".into(),
        region: "auto".into(),
        bucket: "cold-blobs".into(),
        access_key_id: "CAK".into(),
        secret_access_key: "CSK".into(),
    }
}

#[test]
fn empty_env_is_untiered_with_all_r2_names_missing() {
    let cfg = StorageConfig::from_env(|_| None);
    assert!(!cfg.tiered);
    assert_eq!(cfg.hot, Err(R2_MISSING_ALL.to_string()));
    assert_eq!(cfg.cold, None);
    assert_eq!(cfg.view_secret, None);
}

#[test]
fn default_equals_empty_env() {
    assert_eq!(StorageConfig::default(), StorageConfig::from_env(|_| None));
}

#[test]
fn blank_public_provider_falls_back_to_blob_provider() {
    let cfg = StorageConfig::from_env(env_of(&[&[
        ("NEXT_PUBLIC_BLOB_PROVIDER", ""),
        ("BLOB_PROVIDER", "tiered"),
    ]]));
    assert!(cfg.tiered);
}

#[test]
fn public_provider_wins_over_blob_provider() {
    let cfg = StorageConfig::from_env(env_of(&[&[
        ("NEXT_PUBLIC_BLOB_PROVIDER", "supabase"),
        ("BLOB_PROVIDER", "tiered"),
    ]]));
    assert!(!cfg.tiered);
}

#[test]
fn partial_r2_names_only_the_missing_bucket() {
    let cfg = StorageConfig::from_env(env_of(&[&[
        ("R2_ACCOUNT_ID", "acc"),
        ("R2_ACCESS_KEY_ID", "AK"),
        ("R2_SECRET_ACCESS_KEY", "SK"),
    ]]));
    assert_eq!(
        cfg.hot,
        Err("Tiered storage is not configured: missing R2_BUCKET.".to_string())
    );
}

#[test]
fn full_r2_builds_the_r2_endpoint_with_trimmed_values() {
    let padded: &[(&str, &str)] = &[
        ("R2_ACCOUNT_ID", "  acc "),
        ("R2_ACCESS_KEY_ID", "AK"),
        ("R2_SECRET_ACCESS_KEY", "SK"),
        ("R2_BUCKET", " blobs"),
    ];
    let cfg = StorageConfig::from_env(env_of(&[padded]));
    assert_eq!(cfg.hot, Ok(hot_target()));
}

#[test]
fn full_cold_is_used_for_cold_tier_with_trailing_slash_trimmed() {
    let cfg = StorageConfig::from_env(env_of(&[R2, COLD]));
    assert_eq!(cfg.cold, Some(cold_target()));
    assert_eq!(cfg.target_for("cold"), Ok(&cold_target()));
}

#[test]
fn partial_cold_falls_back_to_hot() {
    let cfg = StorageConfig::from_env(env_of(&[
        R2,
        &[
            ("BLOB_COLD_ENDPOINT", "https://cold.example.com"),
            ("BLOB_COLD_ACCESS_KEY_ID", "CAK"),
            ("BLOB_COLD_SECRET_ACCESS_KEY", "CSK"),
        ],
    ]));
    assert_eq!(cfg.cold, None);
    assert_eq!(cfg.target_for("cold"), Ok(&hot_target()));
}

#[test]
fn target_for_hot_and_unknown_tiers_is_hot() {
    let cfg = StorageConfig::from_env(env_of(&[R2, COLD]));
    assert_eq!(cfg.target_for("hot"), Ok(&hot_target()));
    assert_eq!(cfg.target_for("weird"), Ok(&hot_target()));
}

#[test]
fn target_for_hot_with_missing_r2_returns_the_hot_error() {
    let cfg = StorageConfig::from_env(|_| None);
    assert_eq!(cfg.target_for("hot"), Err(R2_MISSING_ALL.to_string()));
    assert_eq!(cfg.target_for("cold"), Err(R2_MISSING_ALL.to_string()));
}

#[test]
fn view_secret_is_trimmed_and_blank_is_none() {
    let set = StorageConfig::from_env(env_of(&[&[("BLOB_VIEW_SECRET", " s3cret ")]]));
    assert_eq!(set.view_secret, Some("s3cret".to_string()));
    let blank = StorageConfig::from_env(env_of(&[&[("BLOB_VIEW_SECRET", "   ")]]));
    assert_eq!(blank.view_secret, None);
}
