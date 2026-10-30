#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, missing_docs)]
//! Tests for the keychain secrets, run against keyring-core's mock store.

use std::sync::Arc;

use keyring_core::CredentialStore;
use keyring_core::mock::Cred;
use weaveforge_shell::commands::ShellError;
use weaveforge_shell::secrets::{PAGE_READABLE, PAGE_WRITABLE, SECRET_NAMES, SecretError, Secrets};

const SERVICE: &str = "org.weaveforge.test";
const UNKNOWN_NAMES: [&str; 6] = [
    "vault-root",
    "",
    "__proto__",
    "AI-PROVIDER",
    " ai-provider",
    "ai-provider ",
];
const NO_KEYCHAIN_TEXT: &str = "This machine has no keychain available, so there is nowhere safe to keep it. It stays in memory for this session.";

fn mock() -> Arc<CredentialStore> {
    keyring_core::mock::Store::new().expect("mock store")
}

fn secrets(store: &Arc<CredentialStore>) -> Secrets {
    Secrets::new(Some(Arc::clone(store)), SERVICE)
}

fn no_store() -> Secrets {
    Secrets::new(None, SERVICE)
}

/// Makes the next keychain call on (`SERVICE`, `name`) fail once with `err`.
fn inject(store: &Arc<CredentialStore>, name: &str, err: keyring_core::Error) {
    let entry = store.build(SERVICE, name, None).expect("entry");
    entry
        .as_any()
        .downcast_ref::<Cred>()
        .expect("mock credential")
        .set_error(err);
}

#[test]
fn every_secret_name_round_trips() {
    let store = mock();
    let s = secrets(&store);
    for name in SECRET_NAMES {
        s.write(name, "value-1").expect("write");
        assert_eq!(s.read(name), Ok(Some("value-1".to_owned())), "{name}");
    }
}

#[test]
fn second_write_replaces_first() {
    let store = mock();
    let s = secrets(&store);
    s.write("ai-provider", "first").expect("write");
    s.write("ai-provider", "second").expect("write");
    assert_eq!(s.read("ai-provider"), Ok(Some("second".to_owned())));
}

#[test]
fn never_written_known_name_reads_none() {
    let s = secrets(&mock());
    assert_eq!(s.read("ai-provider"), Ok(None));
}

#[test]
fn unknown_names_are_refused_by_read_write_and_clear() {
    let s = secrets(&mock());
    for name in UNKNOWN_NAMES {
        assert_eq!(s.read(name), Err(SecretError::UnknownName), "read {name:?}");
        assert_eq!(
            s.write(name, "v"),
            Err(SecretError::UnknownName),
            "write {name:?}"
        );
        assert_eq!(
            s.clear(name),
            Err(SecretError::UnknownName),
            "clear {name:?}"
        );
    }
}

#[test]
fn empty_value_is_refused_with_its_own_text() {
    let s = secrets(&mock());
    let err = s.write("ai-provider", "").expect_err("empty");
    assert_eq!(err, SecretError::EmptyValue);
    assert_eq!(err.to_string(), "A secret is a non-empty string.");
    assert!(!err.to_string().contains("not something this app stores"));
}

#[test]
fn empty_value_with_no_store_is_empty_value_not_no_keychain() {
    assert_eq!(
        no_store().write("ai-provider", ""),
        Err(SecretError::EmptyValue)
    );
}

#[test]
fn whitespace_unicode_and_long_values_round_trip() {
    let store = mock();
    let s = secrets(&store);
    let long = "x".repeat(2000);
    for value in ["   ", "ключ-🔑-密", long.as_str()] {
        s.write("ai-provider", value).expect("write");
        assert_eq!(s.read("ai-provider"), Ok(Some(value.to_owned())));
    }
}

#[test]
fn no_store_write_read_clear_behave_as_no_keychain() {
    let s = no_store();
    let err = s.write("ai-provider", "v").expect_err("no store");
    assert_eq!(err, SecretError::NoKeychain);
    assert_eq!(err.to_string(), NO_KEYCHAIN_TEXT);
    assert_eq!(s.read("ai-provider"), Ok(None));
    assert_eq!(s.clear("ai-provider"), Ok(()));
}

#[test]
fn clear_forgets_and_is_idempotent() {
    let store = mock();
    let s = secrets(&store);
    s.write("ai-provider", "v").expect("write");
    assert_eq!(s.clear("ai-provider"), Ok(()));
    assert_eq!(s.read("ai-provider"), Ok(None));
    assert_eq!(s.clear("ai-provider"), Ok(()));
    assert_eq!(s.clear("local-api-token"), Ok(()));
}

#[test]
fn writing_or_clearing_one_secret_leaves_another_intact() {
    let store = mock();
    let s = secrets(&store);
    s.write("ai-provider", "ai").expect("write");
    s.write("overleaf-token", "ov").expect("write");
    s.clear("overleaf-token").expect("clear");
    s.write("git-sync-token", "git").expect("write");
    assert_eq!(s.read("ai-provider"), Ok(Some("ai".to_owned())));
}

#[test]
fn services_on_one_store_do_not_see_each_other() {
    let store = mock();
    let a = Secrets::new(Some(Arc::clone(&store)), "org.weaveforge.a");
    let b = Secrets::new(Some(Arc::clone(&store)), "org.weaveforge.b");
    a.write("ai-provider", "from-a").expect("write");
    assert_eq!(b.read("ai-provider"), Ok(None));
    assert_eq!(a.read("ai-provider"), Ok(Some("from-a".to_owned())));
}

#[test]
fn read_errors_become_none_and_the_next_read_succeeds() {
    let store = mock();
    let s = secrets(&store);
    s.write("ai-provider", "kept").expect("write");
    inject(
        &store,
        "ai-provider",
        keyring_core::Error::PlatformFailure("boom".into()),
    );
    assert_eq!(s.read("ai-provider"), Ok(None));
    assert_eq!(s.read("ai-provider"), Ok(Some("kept".to_owned())));

    inject(
        &store,
        "ai-provider",
        keyring_core::Error::BadEncoding(vec![0xff]),
    );
    assert_eq!(s.read("ai-provider"), Ok(None));
    assert_eq!(s.read("ai-provider"), Ok(Some("kept".to_owned())));
}

#[test]
fn write_errors_map_to_their_variants_and_keep_the_old_value() {
    let store = mock();
    let s = secrets(&store);
    s.write("ai-provider", "old").expect("write");

    inject(
        &store,
        "ai-provider",
        keyring_core::Error::NoStorageAccess("no".into()),
    );
    assert_eq!(s.write("ai-provider", "new"), Err(SecretError::NoKeychain));
    assert_eq!(s.read("ai-provider"), Ok(Some("old".to_owned())));

    inject(
        &store,
        "ai-provider",
        keyring_core::Error::PlatformFailure("boom".into()),
    );
    assert_eq!(s.write("ai-provider", "new"), Err(SecretError::Unreachable));
    assert_eq!(s.read("ai-provider"), Ok(Some("old".to_owned())));

    inject(
        &store,
        "ai-provider",
        keyring_core::Error::TooLong("x".into(), 10),
    );
    assert_eq!(s.write("ai-provider", "new"), Err(SecretError::TooLong));
    assert_eq!(s.read("ai-provider"), Ok(Some("old".to_owned())));
}

#[test]
fn clear_error_is_unreachable_and_the_value_stays() {
    let store = mock();
    let s = secrets(&store);
    s.write("ai-provider", "keep").expect("write");
    inject(
        &store,
        "ai-provider",
        keyring_core::Error::PlatformFailure("boom".into()),
    );
    assert_eq!(s.clear("ai-provider"), Err(SecretError::Unreachable));
    assert_eq!(s.read("ai-provider"), Ok(Some("keep".to_owned())));
}

#[test]
fn page_read_returns_ai_provider_and_refuses_other_names_even_when_stored() {
    let store = mock();
    let s = secrets(&store);
    s.write("ai-provider", "ai").expect("write");
    s.write("local-api-token", "local").expect("write");
    s.write("overleaf-token", "ov").expect("write");
    s.write("git-sync-token", "git").expect("write");
    assert_eq!(s.page_read("ai-provider"), Ok(Some("ai".to_owned())));
    for name in ["local-api-token", "overleaf-token", "git-sync-token"] {
        assert_eq!(s.page_read(name), Err(SecretError::UnknownName), "{name}");
    }
}

#[test]
fn page_write_and_clear_work_for_overleaf_and_git_sync_tokens() {
    let store = mock();
    let s = secrets(&store);
    for name in ["overleaf-token", "git-sync-token"] {
        s.page_write(name, "tok").expect("page_write");
        assert_eq!(s.read(name), Ok(Some("tok".to_owned())), "{name}");
        s.page_clear(name).expect("page_clear");
        assert_eq!(s.read(name), Ok(None), "{name}");
    }
}

#[test]
fn page_write_and_clear_refuse_local_api_token_and_keep_its_value() {
    let store = mock();
    let s = secrets(&store);
    s.write("local-api-token", "local").expect("write");
    assert_eq!(
        s.page_write("local-api-token", "x"),
        Err(SecretError::UnknownName)
    );
    assert_eq!(
        s.page_clear("local-api-token"),
        Err(SecretError::UnknownName)
    );
    assert_eq!(s.read("local-api-token"), Ok(Some("local".to_owned())));
}

#[test]
fn page_methods_refuse_unknown_names() {
    let s = secrets(&mock());
    for name in UNKNOWN_NAMES {
        assert_eq!(
            s.page_read(name),
            Err(SecretError::UnknownName),
            "read {name:?}"
        );
        assert_eq!(
            s.page_write(name, "v"),
            Err(SecretError::UnknownName),
            "write {name:?}"
        );
        assert_eq!(
            s.page_clear(name),
            Err(SecretError::UnknownName),
            "clear {name:?}"
        );
    }
}

#[test]
fn page_write_ai_provider_refuses_empty_and_no_store() {
    assert_eq!(
        secrets(&mock()).page_write("ai-provider", ""),
        Err(SecretError::EmptyValue)
    );
    assert_eq!(
        no_store().page_write("ai-provider", "v"),
        Err(SecretError::NoKeychain)
    );
}

#[test]
fn error_texts_match_the_spec_exactly() {
    assert_eq!(
        SecretError::UnknownName.to_string(),
        "That is not something this app stores."
    );
    assert_eq!(
        SecretError::EmptyValue.to_string(),
        "A secret is a non-empty string."
    );
    assert_eq!(SecretError::NoKeychain.to_string(), NO_KEYCHAIN_TEXT);
    assert_eq!(
        SecretError::TooLong.to_string(),
        "That is too long for this machine's keychain, so nothing was changed."
    );
    assert_eq!(
        SecretError::Unreachable.to_string(),
        "The keychain could not be reached just now, so nothing was changed."
    );
}

#[test]
fn shared_error_texts_match_the_typescript_constants() {
    let ts = include_str!("../../desktop/src/secret-store.ts");
    let unknown = SecretError::UnknownName.to_string();
    assert!(ts.contains(&format!("\"{unknown}\"")));
    let (first, second) = NO_KEYCHAIN_TEXT.split_at(
        "This machine has no keychain available, so there is nowhere safe to keep it. ".len(),
    );
    assert!(ts.contains(&format!("\"{first}\"")));
    assert!(ts.contains(&format!("\"{second}\"")));
    assert_eq!(SecretError::NoKeychain.to_string(), NO_KEYCHAIN_TEXT);
    assert_eq!(
        SecretError::EmptyValue.to_string(),
        "A secret is a non-empty string."
    );
}

#[test]
fn page_lists_are_subsets_and_names_are_unique() {
    for name in PAGE_READABLE.iter().chain(PAGE_WRITABLE.iter()) {
        assert!(SECRET_NAMES.contains(name), "{name}");
    }
    let mut names = SECRET_NAMES.to_vec();
    names.sort_unstable();
    names.dedup();
    assert_eq!(names.len(), SECRET_NAMES.len());
}

#[test]
fn shell_error_from_no_keychain_carries_the_text() {
    assert_eq!(
        ShellError::from(SecretError::NoKeychain).message,
        NO_KEYCHAIN_TEXT
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_clear_sent_after_a_write_wins_even_when_neither_is_awaited() {
    let store = mock();
    let s = secrets(&store);
    for i in 0..100 {
        let value = format!("v{i}");
        let write = s.queued(move |s| s.write("ai-provider", &value));
        let clear = s.queued(|s| s.clear("ai-provider"));
        let (w, c) = tokio::join!(write, clear);
        assert_eq!(w, Ok(()));
        assert_eq!(c, Ok(()));
        assert_eq!(
            s.read("ai-provider"),
            Ok(None),
            "round {i}: the clear must land last"
        );
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn queued_returns_the_work_result_and_its_error() {
    let s = secrets(&mock());
    assert_eq!(s.queued(|s| s.write("ai-provider", "x")).await, Ok(()));
    assert_eq!(
        s.queued(|s| s.read("ai-provider")).await,
        Ok(Some("x".to_owned()))
    );
    assert_eq!(
        s.queued(|s| s.write("ai-provider", "")).await,
        Err(SecretError::EmptyValue)
    );
}
