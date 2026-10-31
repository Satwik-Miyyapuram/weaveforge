//! Shell host for the sidecar: the allowlists, the value mapping and the refusals, with fake stores.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod common;

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use common::{TempDir, put};
use serde_json::{Value, json};
use weaveforge_shell::host::{
    HOST_URL_PREFIXES, Opener, PrefAccess, SecretAccess, ShellHost, WindowEvents,
};
use weaveforge_shell::launch::without_verbatim_prefix;
use weaveforge_shell::prefs::PrefValue;
use weaveforge_shell::sidecar::SidecarHost;

#[derive(Default)]
struct FakePrefs(Mutex<HashMap<String, PrefValue>>);

impl PrefAccess for FakePrefs {
    fn read(&self, name: &str) -> Result<Option<PrefValue>, String> {
        Ok(self.0.lock().unwrap().get(name).cloned())
    }

    fn write(&self, name: &str, value: Option<PrefValue>) -> Result<(), String> {
        let mut map = self.0.lock().unwrap();
        match value {
            Some(v) => {
                let _ = map.insert(name.to_owned(), v);
            }
            None => {
                let _ = map.remove(name);
            }
        }
        Ok(())
    }
}

struct FakeSecrets {
    map: Mutex<HashMap<String, String>>,
    fail: bool,
}

impl SecretAccess for FakeSecrets {
    fn read(&self, name: &str) -> Result<Option<String>, String> {
        if self.fail {
            return Err("store down".to_owned());
        }
        Ok(self.map.lock().unwrap().get(name).cloned())
    }

    fn write(&self, name: &str, value: &str) -> Result<(), String> {
        if self.fail {
            return Err("store down".to_owned());
        }
        let _ = self
            .map
            .lock()
            .unwrap()
            .insert(name.to_owned(), value.to_owned());
        Ok(())
    }

    fn clear(&self, name: &str) -> Result<(), String> {
        if self.fail {
            return Err("store down".to_owned());
        }
        let _ = self.map.lock().unwrap().remove(name);
        Ok(())
    }
}

#[derive(Default)]
struct FakeOpener {
    urls: Mutex<Vec<String>>,
    paths: Mutex<Vec<PathBuf>>,
}

impl Opener for FakeOpener {
    fn open_url(&self, url: &str) -> Result<(), String> {
        self.urls.lock().unwrap().push(url.to_owned());
        Ok(())
    }

    fn open_path(&self, path: &Path) -> Result<(), String> {
        self.paths.lock().unwrap().push(path.to_path_buf());
        Ok(())
    }
}

#[derive(Default)]
struct FakeWindow(Mutex<Vec<(String, Value)>>);

impl WindowEvents for FakeWindow {
    fn emit(&self, event: &str, payload: Value) {
        self.0.lock().unwrap().push((event.to_owned(), payload));
    }
}

struct Rig {
    prefs: Arc<FakePrefs>,
    secrets: Arc<FakeSecrets>,
    opener: Arc<FakeOpener>,
    window: Arc<FakeWindow>,
    host: ShellHost,
}

fn rig(mcp: &Path, fail: bool) -> Rig {
    let prefs = Arc::new(FakePrefs::default());
    let secrets = Arc::new(FakeSecrets {
        map: Mutex::new(HashMap::new()),
        fail,
    });
    let opener = Arc::new(FakeOpener::default());
    let window = Arc::new(FakeWindow::default());
    let host = ShellHost::new(
        prefs.clone(),
        secrets.clone(),
        opener.clone(),
        window.clone(),
        mcp.to_path_buf(),
    );
    Rig {
        prefs,
        secrets,
        opener,
        window,
        host,
    }
}

/// A base folder with an `mcp` folder inside it; the base holds the parent of `mcp`.
fn mcp_setup() -> (TempDir, PathBuf) {
    let base = TempDir::new();
    let mcp = base.path().join("mcp");
    fs::create_dir_all(&mcp).unwrap();
    (base, mcp)
}

fn text_of(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

#[test]
fn pref_round_trip_maps_text_flag_and_null() {
    let (_base, mcp) = mcp_setup();
    let r = rig(&mcp, false);
    assert_eq!(
        r.host
            .ask("pref.write", json!({"name": "local-api", "value": true})),
        Ok(Value::Null)
    );
    assert_eq!(
        r.host.ask("pref.read", json!({"name": "local-api"})),
        Ok(json!(true))
    );
    assert_eq!(
        r.host
            .ask("pref.write", json!({"name": "local-api", "value": "x"})),
        Ok(Value::Null)
    );
    assert_eq!(
        r.host.ask("pref.read", json!({"name": "local-api"})),
        Ok(json!("x"))
    );
    assert_eq!(
        r.prefs.0.lock().unwrap().get("local-api"),
        Some(&PrefValue::Text("x".to_owned()))
    );
    assert_eq!(
        r.host
            .ask("pref.write", json!({"name": "local-api", "value": null})),
        Ok(Value::Null)
    );
    assert_eq!(
        r.host.ask("pref.read", json!({"name": "local-api"})),
        Ok(Value::Null)
    );
    assert!(r.prefs.0.lock().unwrap().is_empty());
}

#[test]
fn pref_not_allowed_is_refused_before_the_store() {
    let (_base, mcp) = mcp_setup();
    let r = rig(&mcp, false);
    let _ = r
        .prefs
        .0
        .lock()
        .unwrap()
        .insert("theme".to_owned(), PrefValue::Text("dark".to_owned()));
    assert_eq!(
        r.host.ask("pref.read", json!({"name": "theme"})),
        Err("pref not allowed: theme".to_owned())
    );
    assert_eq!(
        r.host
            .ask("pref.write", json!({"name": "theme", "value": true})),
        Err("pref not allowed: theme".to_owned())
    );
    assert_eq!(
        r.prefs.0.lock().unwrap().get("theme"),
        Some(&PrefValue::Text("dark".to_owned()))
    );
}

#[test]
fn pref_write_bad_value_is_refused() {
    let (_base, mcp) = mcp_setup();
    let r = rig(&mcp, false);
    for params in [
        json!({"name": "local-api", "value": [1]}),
        json!({"name": "local-api", "value": 3}),
        json!({"name": "local-api"}),
    ] {
        let msg = r.host.ask("pref.write", params.clone()).unwrap_err();
        assert!(
            msg.starts_with("pref.write needs"),
            "params {params}: {msg}"
        );
    }
    assert!(r.prefs.0.lock().unwrap().is_empty());
}

#[test]
fn secret_round_trip_and_absent_read() {
    let (_base, mcp) = mcp_setup();
    let r = rig(&mcp, false);
    assert_eq!(
        r.host
            .ask("secret.read", json!({"name": "local-api-token"})),
        Ok(Value::Null)
    );
    assert_eq!(
        r.host.ask(
            "secret.write",
            json!({"name": "local-api-token", "value": "tok"})
        ),
        Ok(Value::Null)
    );
    assert_eq!(
        r.host
            .ask("secret.read", json!({"name": "local-api-token"})),
        Ok(json!("tok"))
    );
    assert_eq!(
        r.host
            .ask("secret.clear", json!({"name": "local-api-token"})),
        Ok(Value::Null)
    );
    assert_eq!(
        r.host
            .ask("secret.read", json!({"name": "local-api-token"})),
        Ok(Value::Null)
    );
    assert!(r.secrets.map.lock().unwrap().is_empty());
}

#[test]
fn secret_not_allowed_is_refused_before_the_store() {
    let (_base, mcp) = mcp_setup();
    let r = rig(&mcp, false);
    assert_eq!(
        r.host.ask("secret.read", json!({"name": "github-token"})),
        Err("secret not allowed: github-token".to_owned())
    );
    assert_eq!(
        r.host.ask(
            "secret.write",
            json!({"name": "github-token", "value": "x"})
        ),
        Err("secret not allowed: github-token".to_owned())
    );
    assert_eq!(
        r.host.ask("secret.clear", json!({"name": "github-token"})),
        Err("secret not allowed: github-token".to_owned())
    );
    assert!(r.secrets.map.lock().unwrap().is_empty());
}

#[test]
fn store_error_passes_through() {
    let (_base, mcp) = mcp_setup();
    let r = rig(&mcp, true);
    assert_eq!(
        r.host
            .ask("secret.read", json!({"name": "local-api-token"})),
        Err("store down".to_owned())
    );
    assert_eq!(
        r.host.ask(
            "secret.write",
            json!({"name": "local-api-token", "value": "tok"})
        ),
        Err("store down".to_owned())
    );
    assert_eq!(
        r.host
            .ask("secret.clear", json!({"name": "local-api-token"})),
        Err("store down".to_owned())
    );
}

#[test]
fn open_url_allows_only_editor_install_prefixes() {
    let (_base, mcp) = mcp_setup();
    let r = rig(&mcp, false);
    let mut ok: Vec<String> = HOST_URL_PREFIXES
        .iter()
        .map(|prefix| format!("{prefix}payload"))
        .collect();
    ok.push("CURSOR://anysphere.cursor-deeplink/mcp/install?name=weaveforge&config=abc".to_owned());
    for url in &ok {
        assert_eq!(
            r.host.ask("open.url", json!({ "url": url })),
            Ok(Value::Null),
            "url {url}"
        );
    }
    assert_eq!(*r.opener.urls.lock().unwrap(), ok);

    let refused = [
        "https://evil.example",
        "file:///C:/x",
        "javascript:alert(1)",
        "vscode://file/C:/x",
        "vscode://vscode.git/clone?url=x",
        "cursor://anysphere.cursor-deeplink/mcp/install?name=evil&config=",
        "vscode:extension/foo",
        "cursor:",
        "https://x",
        "",
        "x",
        "vscodé:mcp/install?",
    ];
    for url in refused {
        assert_eq!(
            r.host.ask("open.url", json!({ "url": url })),
            Err("url not allowed".to_owned()),
            "url {url}"
        );
    }
    assert_eq!(r.opener.urls.lock().unwrap().len(), ok.len());
}

#[test]
fn open_path_allows_only_mcpb_files_directly_in_the_mcp_folder() {
    let (base, mcp) = mcp_setup();
    let other = TempDir::new();
    put(&mcp.join("weaveforge.mcpb"), b"x");
    put(&mcp.join("Upper.MCPB"), b"x");
    put(&mcp.join("x.txt"), b"x");
    put(&mcp.join("sub/x.mcpb"), b"x");
    put(&other.path().join("x.mcpb"), b"x");
    put(&base.path().join("x.mcpb"), b"x");
    let r = rig(&mcp, false);

    let allowed = [mcp.join("weaveforge.mcpb"), mcp.join("Upper.MCPB")];
    for path in &allowed {
        assert_eq!(
            r.host.ask("open.path", json!({ "path": text_of(path) })),
            Ok(Value::Null)
        );
    }
    let expected: Vec<PathBuf> = allowed
        .iter()
        .map(|p| without_verbatim_prefix(&fs::canonicalize(p).unwrap()))
        .collect();
    assert_eq!(*r.opener.paths.lock().unwrap(), expected);
    for opened in r.opener.paths.lock().unwrap().iter() {
        assert!(
            !opened.to_string_lossy().starts_with(r"\\?\"),
            "{}",
            opened.display()
        );
    }

    let refused = [
        mcp.join("x.txt"),
        mcp.join("sub").join("x.mcpb"),
        other.path().join("x.mcpb"),
        mcp.join("..").join("x.mcpb"),
        mcp.join("missing.mcpb"),
    ];
    for path in &refused {
        assert_eq!(
            r.host.ask("open.path", json!({ "path": text_of(path) })),
            Err("path not allowed".to_owned()),
            "path {}",
            path.display()
        );
    }
    assert_eq!(r.opener.paths.lock().unwrap().len(), allowed.len());
}

#[test]
fn unknown_method_and_non_object_params_are_refused() {
    let (_base, mcp) = mcp_setup();
    let r = rig(&mcp, false);
    assert_eq!(
        r.host.ask("vault.read", json!({})),
        Err("unknown ask: vault.read".to_owned())
    );
    let msg = r.host.ask("pref.read", json!("x")).unwrap_err();
    assert!(msg.starts_with("pref.read needs"), "{msg}");
}

#[test]
fn only_semantic_rank_is_forwarded_to_the_window() {
    let (_base, mcp) = mcp_setup();
    let r = rig(&mcp, false);
    let payload = json!({"query": "rust", "limit": 3});
    r.host.event("semanticRank", payload.clone());
    r.host.event("other", json!(1));
    assert_eq!(
        *r.window.0.lock().unwrap(),
        vec![("semanticRank".to_owned(), payload)]
    );
}
