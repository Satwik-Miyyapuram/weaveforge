//! Blob access rules, matching `apps/web/src/storage/server/blob-access.ts`,
//! `apps/web/src/storage/signed-url-limits.ts` and `blob-view-token.ts`.

#![allow(clippy::unwrap_used, clippy::expect_used, missing_docs)]

use wf_core::storage::blob_access::{
    BLOB_STORAGE_BUCKETS, BlobRefusal, base64_byte_length, blob_cache_control,
    check_allowed_bucket, check_path_owned, clamp_ttl_seconds, is_safe_segment,
    resource_id_from_path, shared_resource_for, view_token_exp,
};

const UUID: &str = "123e4567-e89b-42d3-a456-426614174000";

#[test]
fn every_bucket_is_allowed() {
    for bucket in BLOB_STORAGE_BUCKETS {
        assert_eq!(check_allowed_bucket(bucket), Ok(()));
    }
}

#[test]
fn unknown_bucket_is_refused() {
    assert_eq!(
        check_allowed_bucket("other"),
        Err(BlobRefusal {
            status: 400,
            message: "Unsupported blob bucket.",
        })
    );
}

#[test]
fn owned_path_is_accepted() {
    assert_eq!(check_path_owned("u1/a.png", "u1"), Ok(()));
}

#[test]
fn empty_path_is_malformed() {
    assert_eq!(check_path_owned("", "u1").unwrap_err().status, 400);
}

#[test]
fn traversal_path_is_malformed() {
    let err = check_path_owned("u1/../x", "u1").unwrap_err();
    assert_eq!(err.status, 400);
    assert_eq!(err.message, "Invalid blob path.");
}

#[test]
fn leading_slash_path_is_malformed() {
    assert_eq!(check_path_owned("/u1/x", "u1").unwrap_err().status, 400);
}

#[test]
fn backslash_path_is_malformed() {
    assert_eq!(check_path_owned("a\\b", "u1").unwrap_err().status, 400);
}

#[test]
fn other_users_path_is_forbidden() {
    let err = check_path_owned("u2/a.png", "u1").unwrap_err();
    assert_eq!(err.status, 403);
    assert_eq!(err.message, "Forbidden blob path.");
}

#[test]
fn prefix_with_nothing_after_is_forbidden() {
    let err = check_path_owned("u1/", "u1").unwrap_err();
    assert_eq!(err.status, 403);
    assert_eq!(err.message, "Forbidden blob path.");
}

#[test]
fn path_that_only_shares_uid_text_is_forbidden() {
    assert_eq!(check_path_owned("u10/a.png", "u1").unwrap_err().status, 403);
}

#[test]
fn shared_resource_names_per_bucket() {
    assert_eq!(shared_resource_for("paper-images"), Some("paper"));
    assert_eq!(
        shared_resource_for("experiment-artifacts"),
        Some("experiment")
    );
    assert_eq!(shared_resource_for("vault-assets"), Some("vault_page"));
    assert_eq!(shared_resource_for("report-images"), Some("report_section"));
    assert_eq!(shared_resource_for("log-images"), Some("log_entry"));
    assert_eq!(shared_resource_for("other"), None);
}

#[test]
fn resource_id_is_second_segment_when_uuid() {
    let path = format!("u1/{UUID}/file.png");
    assert_eq!(resource_id_from_path(&path), Some(UUID));
}

#[test]
fn resource_id_accepts_uppercase_uuid() {
    let upper = UUID.to_ascii_uppercase();
    let path = format!("u1/{upper}/f.png");
    assert_eq!(resource_id_from_path(&path), Some(upper.as_str()));
}

#[test]
fn resource_id_rejects_version_six() {
    assert_eq!(
        resource_id_from_path("u1/123e4567-e89b-62d3-a456-426614174000/f.png"),
        None
    );
}

#[test]
fn resource_id_rejects_bad_variant() {
    assert_eq!(
        resource_id_from_path("u1/123e4567-e89b-42d3-c456-426614174000/f.png"),
        None
    );
}

#[test]
fn resource_id_rejects_non_uuid_segment() {
    assert_eq!(resource_id_from_path("u1/not-a-uuid/f.png"), None);
    assert_eq!(resource_id_from_path("u1"), None);
}

#[test]
fn ttl_defaults_to_max_when_missing_or_not_finite() {
    assert_eq!(clamp_ttl_seconds(None), 3600);
    assert_eq!(clamp_ttl_seconds(Some(f64::NAN)), 3600);
    assert_eq!(clamp_ttl_seconds(Some(f64::INFINITY)), 3600);
}

#[test]
fn ttl_is_floored_and_clamped() {
    assert_eq!(clamp_ttl_seconds(Some(59.9)), 60);
    assert_eq!(clamp_ttl_seconds(Some(61.7)), 61);
    assert_eq!(clamp_ttl_seconds(Some(1e9)), 3600);
    assert_eq!(clamp_ttl_seconds(Some(-5.0)), 60);
    assert_eq!(clamp_ttl_seconds(Some(120.0)), 120);
}

#[test]
fn view_token_exp_rounds_up_to_five_minutes() {
    assert_eq!(view_token_exp(1000, 3600), 4800);
    assert_eq!(view_token_exp(4500, 0), 4500);
}

#[test]
fn cache_control_private_while_token_lives() {
    assert_eq!(
        blob_cache_control(4800, 1000),
        "private, max-age=3800, immutable"
    );
}

#[test]
fn cache_control_no_store_once_expired() {
    assert_eq!(blob_cache_control(1000, 1000), "private, no-store");
    assert_eq!(blob_cache_control(900, 1000), "private, no-store");
}

#[test]
fn safe_segment_accepts_plain_names() {
    assert!(is_safe_segment("exp_1-2.final"));
    assert!(is_safe_segment(&"a".repeat(128)));
}

#[test]
fn safe_segment_rejects_bad_values() {
    assert!(!is_safe_segment(""));
    assert!(!is_safe_segment("."));
    assert!(!is_safe_segment(".."));
    assert!(!is_safe_segment("a/b"));
    assert!(!is_safe_segment("a b"));
    assert!(!is_safe_segment(&"a".repeat(129)));
}

#[test]
fn base64_length_accounts_for_padding() {
    assert_eq!(base64_byte_length("AAAA"), 3);
    assert_eq!(base64_byte_length("AAA="), 2);
    assert_eq!(base64_byte_length("AA=="), 1);
    assert_eq!(base64_byte_length(""), 0);
}
