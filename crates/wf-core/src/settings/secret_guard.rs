//! Keeps secrets out of workspace config files (files-first, L7).
//!
//! Secrets (API keys, git and Overleaf tokens, passwords) live in the OS keychain.
//! Config files (`**/.weaveforge/**/*.json`, `**/.weaveforge/**/*.jsonl`, `.overleaf.json`)
//! sync through git, so a write that would put a secret in one is refused. A value
//! counts as a secret when its key names one (`apiKey`, `token`, `password`, ...) or
//! when it has the shape of a known token (`sk-...`, `ghp_...`, a private key, ...).
//! The refusal names where the secret sits, never its value. Pure: no I/O.

use serde_json::Value;

use crate::sync::folder_layout::WORKSPACE_META_DIR;

/// Key endings that name a secret, compared lowercase with `-` and `_` removed.
/// Endings, not substrings, so `tokenizer` and `keyboard` stay fine.
const SECRET_KEY_ENDINGS: &[&str] = &[
    "token",
    "secret",
    "password",
    "passwd",
    "apikey",
    "accesskey",
    "privatekey",
    "cookie",
    "credential",
    "credentials",
    "bearer",
];

/// Prefixes of well-known token formats; each must be followed by at least
/// [`MIN_TOKEN_TAIL`] token characters.
const TOKEN_PREFIXES: &[&str] = &[
    "sk-",
    "sk_",
    "ghp_",
    "gho_",
    "ghs_",
    "ghu_",
    "github_pat_",
    "glpat-",
    "xoxb-",
    "xoxp-",
    "AKIA",
];
const MIN_TOKEN_TAIL: usize = 16;

/// A write refused because it would store a secret. `location` says where (for
/// example `ai.provider.apiKey`), never what.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SecretRefused {
    /// Dotted path to the secret, or `text` when it was found in the raw text.
    pub location: String,
}

impl std::fmt::Display for SecretRefused {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "Not saved: this would put a secret ({}) in a workspace file that syncs. \
             Secrets are kept in the system keychain instead.",
            self.location
        )
    }
}

impl std::error::Error for SecretRefused {}

/// Whether `key` names a secret.
#[must_use]
pub fn is_secret_key(key: &str) -> bool {
    let norm: String = key
        .chars()
        .filter(|c| *c != '-' && *c != '_')
        .flat_map(char::to_lowercase)
        .collect();
    SECRET_KEY_ENDINGS.iter().any(|end| norm.ends_with(end))
}

fn is_token_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '-' || c == '_'
}

/// Whether `text` holds something shaped like a known token or a private key.
#[must_use]
pub fn contains_token(text: &str) -> bool {
    if text.contains("-----BEGIN") && text.contains("PRIVATE KEY") {
        return true;
    }
    TOKEN_PREFIXES.iter().any(|prefix| {
        text.match_indices(prefix).any(|(at, _)| {
            let starts_word = text[..at]
                .chars()
                .next_back()
                .is_none_or(|c| !c.is_ascii_alphanumeric());
            let tail = text[at + prefix.len()..]
                .chars()
                .take_while(|c| is_token_char(*c))
                .count();
            starts_word && tail >= MIN_TOKEN_TAIL
        })
    })
}

/// Where in `value` a secret sits, if anywhere: a secret-named key with a non-empty
/// string, or a token-shaped string under any key.
#[must_use]
pub fn find_secret(value: &Value) -> Option<String> {
    find_at(value, "")
}

fn join(base: &str, key: &str) -> String {
    if base.is_empty() {
        key.to_owned()
    } else {
        format!("{base}.{key}")
    }
}

fn find_at(value: &Value, at: &str) -> Option<String> {
    match value {
        Value::String(s) => contains_token(s).then(|| at.to_owned()),
        Value::Array(items) => items
            .iter()
            .enumerate()
            .find_map(|(i, v)| find_at(v, &format!("{at}[{i}]"))),
        Value::Object(map) => map.iter().find_map(|(k, v)| {
            let here = join(at, k);
            let named = is_secret_key(k) && v.as_str().is_some_and(|s| !s.is_empty());
            if named { Some(here) } else { find_at(v, &here) }
        }),
        _ => None,
    }
}

/// Checks `value` before it is written to a config file.
///
/// # Errors
///
/// [`SecretRefused`] naming where the secret sits.
pub fn check_value(value: &Value) -> Result<(), SecretRefused> {
    match find_secret(value) {
        Some(location) => Err(SecretRefused { location }),
        None => Ok(()),
    }
}

/// Workspace folders under `.weaveforge/` that hold copies of document text, not
/// config, so [`is_config_path`] never matches below them. The PDF text cache
/// (`apps/web/src/features/search/application/parts-1.ts`) stores a paper's own
/// words, and a paper that prints a token-shaped string must still be cached.
/// Each entry is a root-relative folder; add one only for such copied content.
pub const NOT_CONFIG_DIRS: &[&str] = &[".weaveforge/cache/pdf-text"];

/// Whether `path` (workspace-relative) is a config file guarded by [`check_config_write`]:
/// any `.overleaf.json`, and any `.json` or `.jsonl` file below a `.weaveforge` folder at
/// any depth. Case is ignored and trailing dots and spaces are dropped from each part,
/// because Windows and macOS open the same file under those spellings.
#[must_use]
pub fn is_config_path(path: &str) -> bool {
    let parts = path_parts(path);
    if NOT_CONFIG_DIRS
        .iter()
        .any(|dir| parts.starts_with(&path_parts(dir)))
    {
        return false;
    }
    let Some((name, dirs)) = parts.split_last() else {
        return false;
    };
    if name == ".overleaf.json" {
        return true;
    }
    dirs.iter().any(|dir| dir == WORKSPACE_META_DIR)
        && (name.ends_with(".json") || name.ends_with(".jsonl"))
}

/// The parts of `path` as the file system compares them: lowercase, trailing dots and
/// spaces dropped, empty and `.` parts skipped.
fn path_parts(path: &str) -> Vec<String> {
    path.split(['/', '\\'])
        .map(|part| part.trim_end_matches(['.', ' ']).to_lowercase())
        .filter(|part| !part.is_empty())
        .collect()
}

/// Checks a write of `contents` to `path`. Paths that are not config files pass.
///
/// # Errors
///
/// [`SecretRefused`] when a config file would hold a secret.
pub fn check_config_write(path: &str, contents: &str) -> Result<(), SecretRefused> {
    if !is_config_path(path) {
        return Ok(());
    }
    if contains_token(contents) {
        return Err(SecretRefused {
            location: "text".to_owned(),
        });
    }
    if let Ok(value) = serde_json::from_str::<Value>(contents) {
        return check_value(&value);
    }
    // JSON Lines: each line on its own.
    for (n, line) in contents.lines().enumerate() {
        if let Ok(value) = serde_json::from_str::<Value>(line) {
            check_value(&value).map_err(|e| SecretRefused {
                location: format!("line {}: {}", n + 1, e.location),
            })?;
        }
    }
    Ok(())
}

/// [`check_config_write`] for raw bytes: a binary write or a rename that lands on
/// `path`. A config file that is not UTF-8 cannot be checked, so it is refused.
///
/// # Errors
///
/// [`SecretRefused`] when a config file would hold a secret or is not UTF-8 text.
pub fn check_config_bytes(path: &str, bytes: &[u8]) -> Result<(), SecretRefused> {
    if !is_config_path(path) {
        return Ok(());
    }
    let text = std::str::from_utf8(bytes).map_err(|_| SecretRefused {
        location: "binary data that cannot be checked".to_owned(),
    })?;
    check_config_write(path, text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys() {
        for k in [
            "apiKey",
            "API_KEY",
            "githubToken",
            "client-secret",
            "password",
            "cookie",
        ] {
            assert!(is_secret_key(k), "{k}");
        }
        for k in [
            "tokenizer",
            "keyboard",
            "sortKey",
            "maxTokens",
            "author",
            "passwordHint",
        ] {
            assert!(!is_secret_key(k), "{k}");
        }
    }

    #[test]
    fn token_shapes() {
        assert!(contains_token("key sk-ant-abcdefghijklmnopqrstu here"));
        assert!(
            !contains_token("task-abcdefghijklmnopqrstuvwxyz"),
            "not at a word start"
        );
        assert!(!contains_token("sk-short"));
        assert!(contains_token("AKIAABCDEFGHIJKLMNOP"));
    }

    #[test]
    fn empty_secret_key_is_fine() {
        assert!(check_value(&serde_json::json!({"apiKey": "", "token": null})).is_ok());
    }
}
