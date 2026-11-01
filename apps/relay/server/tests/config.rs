#![allow(clippy::unwrap_used, clippy::expect_used, missing_docs)]

use std::collections::HashMap;

use wf_relay_server::config::Config;

fn env(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> {
    let map: HashMap<String, String> = pairs
        .iter()
        .map(|(k, v)| ((*k).to_string(), (*v).to_string()))
        .collect();
    move |key: &str| map.get(key).cloned()
}

const REQUIRED: [(&str, &str); 3] = [
    ("NEXT_PUBLIC_SUPABASE_URL", "https://abc.supabase.co"),
    ("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon"),
    ("SUPABASE_SERVICE_ROLE_KEY", "service"),
];

#[test]
fn defaults_fill_data_url_bind_origins_and_secret() {
    let config = Config::from_env(env(&REQUIRED)).expect("valid config");
    assert_eq!(config.supabase_url, "https://abc.supabase.co");
    assert_eq!(config.data_url, "https://abc.supabase.co/rest/v1");
    assert_eq!(config.anon_key, "anon");
    assert_eq!(config.service_role_key, "service");
    assert_eq!(config.jwt_secret, None);
    assert!(config.allowed_origins.is_empty());
    assert_eq!(config.bind.to_string(), "0.0.0.0:8787");
}

#[test]
fn each_required_variable_is_named_when_missing() {
    for (name, _) in REQUIRED {
        let pairs: Vec<(&str, &str)> = REQUIRED
            .iter()
            .copied()
            .filter(|(n, _)| *n != name)
            .collect();
        let error = Config::from_env(env(&pairs)).expect_err("missing variable");
        assert!(error.contains(name), "error {error:?} should name {name}");
    }
}

#[test]
fn blank_required_value_counts_as_missing() {
    let pairs = [
        ("NEXT_PUBLIC_SUPABASE_URL", "https://abc.supabase.co"),
        ("NEXT_PUBLIC_SUPABASE_ANON_KEY", "   "),
        ("SUPABASE_SERVICE_ROLE_KEY", "service"),
    ];
    let error = Config::from_env(env(&pairs)).expect_err("blank anon key");
    assert!(error.contains("NEXT_PUBLIC_SUPABASE_ANON_KEY"));
}

#[test]
fn trailing_slashes_are_trimmed_from_urls() {
    let pairs = [
        ("NEXT_PUBLIC_SUPABASE_URL", "https://abc.supabase.co//"),
        ("NEXT_PUBLIC_DATA_URL", "https://abc.supabase.co/rest/v1/"),
        ("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon"),
        ("SUPABASE_SERVICE_ROLE_KEY", "service"),
    ];
    let config = Config::from_env(env(&pairs)).expect("valid config");
    assert_eq!(config.supabase_url, "https://abc.supabase.co");
    assert_eq!(config.data_url, "https://abc.supabase.co/rest/v1");
}

#[test]
fn data_url_defaults_from_trimmed_supabase_url() {
    let pairs = [
        ("NEXT_PUBLIC_SUPABASE_URL", "https://abc.supabase.co/"),
        ("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon"),
        ("SUPABASE_SERVICE_ROLE_KEY", "service"),
    ];
    let config = Config::from_env(env(&pairs)).expect("valid config");
    assert_eq!(config.data_url, "https://abc.supabase.co/rest/v1");
}

#[test]
fn allowed_origins_are_split_trimmed_and_empty_items_dropped() {
    let mut pairs = REQUIRED.to_vec();
    pairs.push((
        "RELAY_ALLOWED_ORIGINS",
        " https://a.example , ,https://b.example,, ",
    ));
    let config = Config::from_env(env(&pairs)).expect("valid config");
    assert_eq!(
        config.allowed_origins,
        vec!["https://a.example".to_string(), "https://b.example".to_string()]
    );
}

#[test]
fn jwt_secret_is_read_when_present() {
    let mut pairs = REQUIRED.to_vec();
    pairs.push(("SUPABASE_JWT_SECRET", "s3cret"));
    let config = Config::from_env(env(&pairs)).expect("valid config");
    assert_eq!(config.jwt_secret.as_deref(), Some("s3cret"));
}

#[test]
fn custom_bind_address_is_parsed() {
    let mut pairs = REQUIRED.to_vec();
    pairs.push(("RELAY_BIND", "127.0.0.1:9000"));
    let config = Config::from_env(env(&pairs)).expect("valid config");
    assert_eq!(config.bind.to_string(), "127.0.0.1:9000");
}

#[test]
fn invalid_bind_address_is_rejected_naming_the_variable() {
    let mut pairs = REQUIRED.to_vec();
    pairs.push(("RELAY_BIND", "not-an-address"));
    let error = Config::from_env(env(&pairs)).expect_err("bad bind");
    assert!(error.contains("RELAY_BIND"));
}
