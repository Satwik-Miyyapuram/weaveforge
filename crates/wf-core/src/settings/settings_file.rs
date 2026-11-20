//! The workspace settings file (`.weaveforge/settings.json`, synced) and the device
//! settings file (`.weaveforge/local/device.json`, this machine only). Both are one
//! JSON object; secrets are refused ([`super::secret_guard`]). Pure: no I/O.

use serde_json::{Map, Value};

use super::secret_guard::{SecretRefused, check_value};

/// Why a config file could not be read or written. Nothing is written in any case.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConfigFileError {
    /// The text is not JSON.
    BadJson(String),
    /// The JSON is not an object (or not the shape this file needs).
    BadShape(String),
    /// An id or date would make an unsafe path.
    BadPath(String),
    /// The contents hold a secret.
    Secret(SecretRefused),
}

impl ConfigFileError {
    /// The secret refusal, when that is the reason.
    #[must_use]
    pub fn refused(&self) -> Option<&SecretRefused> {
        match self {
            Self::Secret(r) => Some(r),
            _ => None,
        }
    }
}

impl std::fmt::Display for ConfigFileError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::BadJson(why) => write!(f, "This settings file is not valid JSON: {why}"),
            Self::BadShape(why) => write!(f, "This settings file has the wrong shape: {why}"),
            Self::BadPath(why) => write!(f, "Not a safe file name: {why}"),
            Self::Secret(r) => r.fmt(f),
        }
    }
}

impl std::error::Error for ConfigFileError {}

impl From<SecretRefused> for ConfigFileError {
    fn from(r: SecretRefused) -> Self {
        Self::Secret(r)
    }
}

/// Reads a JSON object; empty text (a missing file) reads as an empty object.
///
/// # Errors
///
/// [`ConfigFileError::BadJson`] or [`ConfigFileError::BadShape`].
pub fn parse_object(text: &str) -> Result<Map<String, Value>, ConfigFileError> {
    if text.trim().is_empty() {
        return Ok(Map::new());
    }
    match serde_json::from_str(text) {
        Ok(Value::Object(map)) => Ok(map),
        Ok(_) => Err(ConfigFileError::BadShape("not an object".to_owned())),
        Err(e) => Err(ConfigFileError::BadJson(e.to_string())),
    }
}

/// Writes `map` as pretty JSON with a final newline, refusing secrets.
///
/// # Errors
///
/// [`ConfigFileError::Secret`].
pub fn render_object(map: &Map<String, Value>) -> Result<String, ConfigFileError> {
    let value = Value::Object(map.clone());
    check_value(&value)?;
    let mut text = serde_json::to_string_pretty(&value)
        .map_err(|e| ConfigFileError::BadJson(e.to_string()))?;
    text.push('\n');
    Ok(text)
}

/// Reads a settings file (workspace or device).
///
/// # Errors
///
/// As [`parse_object`].
pub fn parse_settings(text: &str) -> Result<Map<String, Value>, ConfigFileError> {
    parse_object(text)
}

/// Writes a settings file (workspace or device).
///
/// # Errors
///
/// As [`render_object`].
pub fn render_settings(settings: &Map<String, Value>) -> Result<String, ConfigFileError> {
    render_object(settings)
}

/// `current` with `patch` applied at the top level: a `null` removes the key, any
/// other value replaces it. Keys the patch does not name are kept as they were.
#[must_use]
pub fn apply_patch(current: &Map<String, Value>, patch: &Map<String, Value>) -> Map<String, Value> {
    let mut next = current.clone();
    for (key, value) in patch {
        if value.is_null() {
            let _ = next.remove(key);
        } else {
            let _ = next.insert(key.clone(), value.clone());
        }
    }
    next
}
