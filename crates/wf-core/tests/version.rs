//! Tests for wf_core::version.

#[test]
fn version_matches_cargo_package() {
    assert_eq!(wf_core::version(), env!("CARGO_PKG_VERSION"));
}

#[test]
fn version_is_semver_triple() {
    let parts: Vec<&str> = wf_core::version().split('.').collect();
    assert_eq!(parts.len(), 3);
    for part in parts {
        assert!(!part.is_empty());
        assert!(part.bytes().all(|b| b.is_ascii_digit()));
    }
}
