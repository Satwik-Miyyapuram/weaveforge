//! What the shell does for the local sidecar: a fixed set of preferences, secrets, links and files.
//!
//! The sidecar may ask for nothing outside the allowlists below; every other ask is refused.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde_json::Value;

use crate::prefs::{PrefValue, Prefs};
use crate::secrets::Secrets;
use crate::sidecar::SidecarHost;

/// Preferences the sidecar may touch.
pub const HOST_PREFS: &[&str] = &["local-api"];
/// Secrets the sidecar may touch.
pub const HOST_SECRETS: &[&str] = &["local-api-token"];
/// Window events the sidecar may send.
pub const HOST_EVENTS: &[&str] = &["semanticRank"];
/// The only links `open.url` opens: the editors' MCP install links that apps/desktop/src/mcp-connect.ts builds.
/// `vscode-insiders:` links are refused.
pub const HOST_URL_PREFIXES: &[&str] = &[
    "cursor://anysphere.cursor-deeplink/mcp/install?name=weaveforge&config=",
    "vscode:mcp/install?",
];

/// Preference access, so tests need no file.
pub trait PrefAccess: Send + Sync {
    /// The stored value, if any.
    fn read(&self, name: &str) -> Result<Option<PrefValue>, String>;
    /// Stores or clears (`None`) a value.
    fn write(&self, name: &str, value: Option<PrefValue>) -> Result<(), String>;
}

/// Secret access, so tests need no keychain.
pub trait SecretAccess: Send + Sync {
    /// The stored value, if any.
    fn read(&self, name: &str) -> Result<Option<String>, String>;
    /// Stores a value under `name`, replacing any earlier one.
    fn write(&self, name: &str, value: &str) -> Result<(), String>;
    /// Forgets `name`.
    fn clear(&self, name: &str) -> Result<(), String>;
}

/// The OS handlers for links and files.
pub trait Opener: Send + Sync {
    /// Opens a link with its registered handler.
    fn open_url(&self, url: &str) -> Result<(), String>;
    /// Opens a file with its registered handler.
    fn open_path(&self, path: &Path) -> Result<(), String>;
}

/// Sends an event to the app window.
pub trait WindowEvents: Send + Sync {
    /// Emits `event` with `payload` to the window.
    fn emit(&self, event: &str, payload: Value);
}

impl PrefAccess for Prefs {
    fn read(&self, name: &str) -> Result<Option<PrefValue>, String> {
        crate::prefs::Prefs::read(self, name).map_err(|e| e.to_string())
    }

    fn write(&self, name: &str, value: Option<PrefValue>) -> Result<(), String> {
        crate::prefs::Prefs::write(self, name, value).map_err(|e| e.to_string())
    }
}

impl SecretAccess for Secrets {
    fn read(&self, name: &str) -> Result<Option<String>, String> {
        crate::secrets::Secrets::read(self, name).map_err(|e| e.to_string())
    }

    fn write(&self, name: &str, value: &str) -> Result<(), String> {
        crate::secrets::Secrets::write(self, name, value).map_err(|e| e.to_string())
    }

    fn clear(&self, name: &str) -> Result<(), String> {
        crate::secrets::Secrets::clear(self, name).map_err(|e| e.to_string())
    }
}

impl<R: tauri::Runtime> WindowEvents for tauri::AppHandle<R> {
    fn emit(&self, event: &str, payload: Value) {
        let _ = tauri::Emitter::emit(self, event, payload);
    }
}

/// Answers the sidecar's asks within the allowlists above.
pub struct ShellHost {
    prefs: Arc<dyn PrefAccess>,
    secrets: Arc<dyn SecretAccess>,
    opener: Arc<dyn Opener>,
    window: Arc<dyn WindowEvents>,
    /// The only folder an `open.path` may point into.
    mcp_dir: PathBuf,
}

impl ShellHost {
    /// A host over these stores.
    pub fn new(
        prefs: Arc<dyn PrefAccess>,
        secrets: Arc<dyn SecretAccess>,
        opener: Arc<dyn Opener>,
        window: Arc<dyn WindowEvents>,
        mcp_dir: PathBuf,
    ) -> Self {
        Self {
            prefs,
            secrets,
            opener,
            window,
            mcp_dir,
        }
    }

    /// `pref.read`: the stored preference as JSON, or `null`.
    fn pref_read(&self, params: &Value) -> Result<Value, String> {
        let name = str_field(params, "name").ok_or_else(|| needs("pref.read", "{ name }"))?;
        if !HOST_PREFS.contains(&name) {
            return Err(format!("pref not allowed: {name}"));
        }
        Ok(match self.prefs.read(name)? {
            Some(PrefValue::Text(text)) => Value::String(text),
            Some(PrefValue::Flag(flag)) => Value::Bool(flag),
            None => Value::Null,
        })
    }

    /// `pref.write`: stores a string or flag; `null` clears it.
    fn pref_write(&self, params: &Value) -> Result<Value, String> {
        const SHAPE: &str = "{ name, value }";
        let name = str_field(params, "name").ok_or_else(|| needs("pref.write", SHAPE))?;
        let value = params
            .as_object()
            .and_then(|map| map.get("value"))
            .ok_or_else(|| needs("pref.write", SHAPE))?;
        let mapped = match value {
            Value::Null => None,
            Value::String(text) => Some(PrefValue::Text(text.clone())),
            Value::Bool(flag) => Some(PrefValue::Flag(*flag)),
            _ => return Err(needs("pref.write", SHAPE)),
        };
        if !HOST_PREFS.contains(&name) {
            return Err(format!("pref not allowed: {name}"));
        }
        self.prefs.write(name, mapped)?;
        Ok(Value::Null)
    }

    /// `secret.read`: the stored secret, or `null`.
    fn secret_read(&self, params: &Value) -> Result<Value, String> {
        let name = str_field(params, "name").ok_or_else(|| needs("secret.read", "{ name }"))?;
        if !HOST_SECRETS.contains(&name) {
            return Err(format!("secret not allowed: {name}"));
        }
        Ok(match self.secrets.read(name)? {
            Some(secret) => Value::String(secret),
            None => Value::Null,
        })
    }

    /// `secret.write`: stores a secret under an allowed name.
    fn secret_write(&self, params: &Value) -> Result<Value, String> {
        const SHAPE: &str = "{ name, value }";
        let name = str_field(params, "name").ok_or_else(|| needs("secret.write", SHAPE))?;
        let value = str_field(params, "value").ok_or_else(|| needs("secret.write", SHAPE))?;
        if !HOST_SECRETS.contains(&name) {
            return Err(format!("secret not allowed: {name}"));
        }
        self.secrets.write(name, value)?;
        Ok(Value::Null)
    }

    /// `secret.clear`: forgets an allowed secret.
    fn secret_clear(&self, params: &Value) -> Result<Value, String> {
        let name = str_field(params, "name").ok_or_else(|| needs("secret.clear", "{ name }"))?;
        if !HOST_SECRETS.contains(&name) {
            return Err(format!("secret not allowed: {name}"));
        }
        self.secrets.clear(name)?;
        Ok(Value::Null)
    }

    /// `open.url`: opens an editor install link; the url is never echoed in a refusal.
    fn open_url(&self, params: &Value) -> Result<Value, String> {
        let url = str_field(params, "url").ok_or_else(|| needs("open.url", "{ url }"))?;
        let allowed = HOST_URL_PREFIXES.iter().any(|prefix| {
            url.get(..prefix.len())
                .is_some_and(|head| head.eq_ignore_ascii_case(prefix))
        });
        if !allowed {
            return Err("url not allowed".to_owned());
        }
        self.opener.open_url(url)?;
        Ok(Value::Null)
    }

    /// `open.path`: opens a `.mcpb` file directly inside the mcp folder.
    fn open_path(&self, params: &Value) -> Result<Value, String> {
        let path = str_field(params, "path").ok_or_else(|| needs("open.path", "{ path }"))?;
        let canonical = self
            .mcpb_in_mcp_dir(Path::new(path))
            .ok_or_else(|| "path not allowed".to_owned())?;
        let opened = crate::launch::without_verbatim_prefix(&canonical);
        self.opener.open_path(&opened)?;
        Ok(Value::Null)
    }

    /// The canonical path of `path` when it is a `.mcpb` file directly inside the mcp folder.
    fn mcpb_in_mcp_dir(&self, path: &Path) -> Option<PathBuf> {
        let canonical = std::fs::canonicalize(path).ok()?;
        let dir = std::fs::canonicalize(&self.mcp_dir).ok()?;
        let is_mcpb = canonical
            .extension()
            .and_then(|ext| ext.to_str())
            .is_some_and(|ext| ext.eq_ignore_ascii_case("mcpb"));
        let inside = canonical.parent() == Some(dir.as_path());
        (canonical.is_file() && is_mcpb && inside).then_some(canonical)
    }
}

impl SidecarHost for ShellHost {
    fn event(&self, name: &str, params: Value) {
        if HOST_EVENTS.contains(&name) {
            self.window.emit(name, params);
        }
    }

    fn ask(&self, method: &str, params: Value) -> Result<Value, String> {
        match method {
            "pref.read" => self.pref_read(&params),
            "pref.write" => self.pref_write(&params),
            "secret.read" => self.secret_read(&params),
            "secret.write" => self.secret_write(&params),
            "secret.clear" => self.secret_clear(&params),
            "open.url" => self.open_url(&params),
            "open.path" => self.open_path(&params),
            other => Err(format!("unknown ask: {other}")),
        }
    }
}

/// A string field of an object; `None` when `params` is not an object or the field is not text.
fn str_field<'a>(params: &'a Value, key: &str) -> Option<&'a str> {
    params.as_object()?.get(key)?.as_str()
}

/// The refusal for a call whose params do not have the expected shape.
fn needs(method: &str, shape: &str) -> String {
    format!("{method} needs {shape}")
}
