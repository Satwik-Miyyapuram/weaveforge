//! Settings, device settings, the Overleaf link and AI proposal files (files-first L7).
//! Named cases from the plan, then the laws in `docs/building/core/settings.md#laws`.
//! `keychain_unavailable` lives with the keychain code: `apps/shell/tests/secrets.rs`.

use proptest::prelude::*;
use serde_json::{Map, Value, json};
use wf_core::ai::proposal_file::{parse_proposal_file, render_audit_line, render_proposal_file};
use wf_core::overleaf::link_file::{OverleafLink, parse_overleaf_link, render_overleaf_link};
use wf_core::settings::secret_guard::{SecretRefused, check_config_write, is_config_path};
use wf_core::settings::settings_file::{apply_patch, parse_settings, render_settings};
use wf_core::sync::folder_layout::{DEVICE_SETTINGS_PATH, SETTINGS_PATH};
use wf_core::sync::git_policy::is_local_meta;

#[cfg(test)]
fn obj(value: Value) -> Map<String, Value> {
    serde_json::from_value(value).unwrap()
}

#[test]
fn settings_round_trip() {
    let settings =
        obj(json!({"theme": "crt", "reader": {"zoom": 1.25, "pages": [1, 2]}, "ünï": "✓"}));
    let text = render_settings(&settings).unwrap();
    assert!(text.ends_with('\n'));
    assert_eq!(parse_settings(&text).unwrap(), settings);
    assert_eq!(
        parse_settings("").unwrap(),
        Map::new(),
        "a missing file reads as empty"
    );
    assert!(parse_settings("[1]").is_err(), "settings are an object");
}

#[test]
fn patch_sets_and_removes_keys() {
    let current = obj(json!({"a": 1, "b": 2}));
    let next = apply_patch(&current, &obj(json!({"b": null, "c": 3})));
    assert_eq!(next, obj(json!({"a": 1, "c": 3})));
}

#[test]
fn device_json_not_synced() {
    assert!(
        is_local_meta(DEVICE_SETTINGS_PATH),
        "device.json stays on this device"
    );
    assert!(!is_local_meta(SETTINGS_PATH), "settings.json syncs");
}

#[test]
fn secret_in_settings_refused() {
    for bad in [
        json!({"zoteroApiKey": "abc"}),
        json!({"ai": {"provider": {"api_key": "x"}}}),
        json!({"git": {"token": "x"}}),
        json!({"list": [{"password": "x"}]}),
        json!({"note": "sk-ant-abcdefghijklmnopqrstuvwxyz0123"}),
        json!({"note": "ghp_abcdefghijklmnopqrstuvwxyz0123456789"}),
    ] {
        let err = render_settings(&obj(bad.clone())).unwrap_err();
        assert!(matches!(err.refused(), Some(SecretRefused { .. })), "{bad}");
    }
    // Ordinary words that only look close are fine.
    for ok in [
        json!({"tokenizer": "bpe", "keyboard": "us", "author": "A"}),
        json!({"sortKey": "title"}),
    ] {
        assert!(render_settings(&obj(ok.clone())).is_ok(), "{ok}");
    }
}

#[test]
fn secret_refused_message_never_holds_the_value() {
    let err = render_settings(&obj(json!({"a": {"token": "hunter2-very-secret"}}))).unwrap_err();
    let text = err.to_string();
    assert!(text.contains("a.token"));
    assert!(!text.contains("hunter2"));
}

#[test]
fn overleaf_token_refused() {
    let link = OverleafLink {
        connection: "Main".to_owned(),
        overleaf_project_id: "65a1b2".to_owned(),
        title: "Thesis".to_owned(),
        entry_file: "main.tex".to_owned(),
        external_url: Some("https://www.overleaf.com/project/65a1b2".to_owned()),
        enabled: true,
        last_fetched_at: None,
    };
    let text = render_overleaf_link(&link).unwrap();
    assert_eq!(parse_overleaf_link(&text).unwrap(), link);
    assert!(!text.contains("token"));
    // A file that carries a token is refused, not read.
    let with_token = r#"{"connection":"Main","overleafProjectId":"1","title":"T","entryFile":"main.tex","enabled":true,"token":"olp_x"}"#;
    assert!(parse_overleaf_link(with_token).is_err());
    assert!(check_config_write("reports/thesis/.overleaf.json", with_token).is_err());
}

#[test]
fn ai_proposal_read_by_mcp() {
    let proposal = obj(json!({"id": "p-1", "kind": "note_edit", "payload": {"text": "hi"}}));
    assert!(
        !is_local_meta(".weaveforge/ai/proposals/note-edit.json"),
        "proposals sync with the workspace"
    );
    let text = render_proposal_file(&proposal).unwrap();
    assert_eq!(parse_proposal_file(&text).unwrap(), proposal);
    let line = render_audit_line(&obj(json!({"tool": "get_note", "at": "2026-11-19"}))).unwrap();
    assert!(line.ends_with('\n') && !line[..line.len() - 1].contains('\n'));
    assert!(render_audit_line(&obj(json!({"args": {"apiKey": "x"}}))).is_err());
}

#[test]
fn config_paths() {
    for path in [
        SETTINGS_PATH,
        DEVICE_SETTINGS_PATH,
        ".weaveforge/ai/audit/2026-11/b.jsonl",
        "r/.overleaf.json",
    ] {
        assert!(is_config_path(path), "{path}");
    }
    for path in ["notes/a.md", "notes/token.json", "papers/x.pdf"] {
        assert!(!is_config_path(path), "{path}");
    }
    // A note is not a config file, so the word token in it is fine.
    assert!(check_config_write("notes/a.md", "token: x").is_ok());
}

/// Plurals and case variants of a secret key name a secret too. Names that only look
/// similar (`sortKeys`, `tokenizers`) pass.
#[test]
fn secret_key_plurals_and_variants_refused() {
    for key in [
        "apiKeys",
        "accessTokens",
        "secretKeys",
        "API_KEYS",
        "client-secrets",
        "secretKey",
        "signingKey",
        "authKey",
    ] {
        let text = format!(r#"{{"{key}":"abc"}}"#);
        assert!(check_config_write(SETTINGS_PATH, &text).is_err(), "{key}");
    }
    for key in ["sortKeys", "tokenizers", "keyboards"] {
        let text = format!(r#"{{"{key}":"abc"}}"#);
        assert!(check_config_write(SETTINGS_PATH, &text).is_ok(), "{key}");
    }
}

const SECRET_KEYS: [&str; 8] = [
    "token",
    "apiKey",
    "api_key",
    "password",
    "clientSecret",
    "privateKey",
    "accessToken",
    "cookie",
];
const TOKEN_VALUES: [&str; 5] = [
    "sk-ant-abcdefghijklmnopqrstuvwxyz0123",
    "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
    "github_pat_abcdefghijklmnopqrstuvwxyz0123",
    "xoxb-1234567890-abcdefghijkl",
    "-----BEGIN PRIVATE KEY-----",
];

fn arb_plain() -> impl Strategy<Value = Value> {
    let leaf = prop_oneof![
        any::<bool>().prop_map(Value::from),
        any::<i32>().prop_map(Value::from),
        "[a-z ]{0,8}".prop_map(Value::from),
    ];
    leaf.prop_recursive(3, 16, 4, |inner| {
        prop_oneof![
            proptest::collection::vec(inner.clone(), 0..4).prop_map(Value::from),
            proptest::collection::btree_map("[a-z]{1,6}", inner, 0..4)
                .prop_map(|m| Value::Object(m.into_iter().collect())),
        ]
    })
}

/// Puts `key: value` at a nested spot of `root`, walking down by `steps`.
#[cfg(test)]
fn plant(root: &mut Map<String, Value>, steps: &[usize], key: &str, value: Value) {
    let mut here = root;
    for step in steps {
        let keys: Vec<String> = here.keys().cloned().collect();
        if keys.is_empty() {
            break;
        }
        let k = &keys[step % keys.len()];
        if !here[k].is_object() {
            break;
        }
        here = here.get_mut(k).and_then(Value::as_object_mut).unwrap();
    }
    let _ = here.insert(key.to_owned(), value);
}

proptest! {
    /// Law: no secret value is ever written to a workspace file. A secret-named key
    /// or a token-shaped value anywhere in a config file is refused, and nothing a
    /// config write accepts holds one.
    #[test]
    fn law_no_secret_written(
        base in proptest::collection::btree_map("[a-z]{1,6}", arb_plain(), 0..5),
        steps in proptest::collection::vec(any::<usize>(), 0..4),
        key in 0..SECRET_KEYS.len(),
        token in 0..TOKEN_VALUES.len(),
        by_key in any::<bool>(),
    ) {
        let mut settings: Map<String, Value> = base.into_iter().collect();
        prop_assert!(render_settings(&settings).is_ok(), "plain settings are accepted");
        if by_key {
            plant(&mut settings, &steps, SECRET_KEYS[key], Value::from("anything"));
        } else {
            plant(&mut settings, &steps, "note", Value::from(TOKEN_VALUES[token]));
        }
        prop_assert!(render_settings(&settings).is_err());
        let raw = serde_json::to_string(&settings).unwrap();
        for path in [SETTINGS_PATH, DEVICE_SETTINGS_PATH, ".weaveforge/ai/proposals/p.json"] {
            prop_assert!(check_config_write(path, &raw).is_err());
        }
    }

    /// Law: settings read back as written, and a patch touches only the keys it names.
    #[test]
    fn law_settings_round_trip_and_patch(
        base in proptest::collection::btree_map("[a-z]{1,6}", arb_plain(), 0..5),
        patch in proptest::collection::btree_map("[a-z]{1,6}", proptest::option::of(arb_plain()), 0..4),
    ) {
        let settings: Map<String, Value> = base.into_iter().collect();
        let text = render_settings(&settings).unwrap();
        prop_assert_eq!(&parse_settings(&text).unwrap(), &settings);
        let patch: Map<String, Value> =
            patch.into_iter().map(|(k, v)| (k, v.unwrap_or(Value::Null))).collect();
        let next = apply_patch(&settings, &patch);
        for (k, v) in &settings {
            if !patch.contains_key(k) {
                prop_assert_eq!(next.get(k), Some(v));
            }
        }
        for (k, v) in &patch {
            if v.is_null() {
                prop_assert!(!next.contains_key(k));
            } else {
                prop_assert_eq!(next.get(k), Some(v));
            }
        }
    }
}
