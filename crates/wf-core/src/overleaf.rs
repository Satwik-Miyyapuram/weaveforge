//! Overleaf link rules: project id and entry file validation, section target sanitizing, and project URLs.

pub mod text_ot;

use serde_json::{Map, Value};

/// Entry file used when a report does not name one.
pub const DEFAULT_ENTRY_FILE: &str = "main.tex";

/// Message returned when an entry file path is rejected.
pub const ENTRY_FILE_INVALID: &str = "Entry file path is invalid.";

/// Largest accepted section target line number.
const MAX_SECTION_LINE: i64 = 10_000_000;

/// Longest accepted section target key, in UTF-16 units (matches the JS client).
const MAX_SECTION_KEY_UTF16: usize = 500;

/// Whether `id` is a non-empty Overleaf project id made of ASCII letters, digits, `_` and `-`.
#[must_use]
pub fn is_valid_project_id(id: &str) -> bool {
    !id.is_empty()
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// Error message for an unsafe entry file path, or `None` when the path is acceptable.
#[must_use]
pub fn entry_file_error(path: &str) -> Option<&'static str> {
    let bad_char = path
        .bytes()
        .any(|b| !(b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'/' | b'-')));
    if path.is_empty() || bad_char || path.starts_with('/') || path.contains("..") {
        Some(ENTRY_FILE_INVALID)
    } else {
        None
    }
}

/// The project id from what a user pastes: the id itself, the project page
/// (`https://www.overleaf.com/project/<id>`) or the git URL (`https://git.overleaf.com/<id>`).
#[must_use]
pub fn parse_overleaf_project_id(raw: &str) -> Option<String> {
    let text = crate::reader_analysis::lines::js_trim(raw);
    if is_valid_project_id(text) {
        return Some(text.to_owned());
    }
    let url = url::Url::parse(text).ok()?;
    if url.scheme() != "https" || !url.username().is_empty() || url.password().is_some() {
        return None;
    }
    let host = url.host_str()?;
    let parts: Vec<&str> = url.path().split('/').filter(|p| !p.is_empty()).collect();
    let id = match parts.as_slice() {
        [id] if host == "git.overleaf.com" => *id,
        ["project", id] if host == "overleaf.com" || host == "www.overleaf.com" => *id,
        _ => return None,
    };
    is_valid_project_id(id).then(|| id.to_owned())
}

/// The clone URL; built from a checked id, never from what was pasted.
#[must_use]
pub fn overleaf_git_url(id: &str) -> String {
    format!("https://git.overleaf.com/{id}")
}

/// Browser URL of an Overleaf project.
#[must_use]
pub fn external_url(id: &str) -> String {
    format!("https://www.overleaf.com/project/{id}")
}

/// Validate section targets (section key to line number). `None` when the input is not a valid map.
#[must_use]
pub fn sanitize_section_targets(input: &Value) -> Option<Map<String, Value>> {
    let object = input.as_object()?;
    let mut out = Map::new();
    for (key, value) in object {
        if key.is_empty() || key.encode_utf16().count() > MAX_SECTION_KEY_UTF16 {
            return None;
        }
        if value.is_null() {
            continue;
        }
        let line = section_line(value)?;
        let _previous = out.insert(key.clone(), Value::from(line));
    }
    Some(out)
}

/// Integer line number in `1..=MAX_SECTION_LINE`, accepting whole-valued floats such as `3.0`.
fn section_line(value: &Value) -> Option<i64> {
    let line = match value.as_i64() {
        Some(v) => v,
        None => {
            let f = value.as_f64()?;
            if !f.is_finite() || f.fract() != 0.0 {
                return None;
            }
            f.to_string().parse::<i64>().ok()?
        }
    };
    (1..=MAX_SECTION_LINE).contains(&line).then_some(line)
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn project_id_rules() {
        assert!(is_valid_project_id("abc_DEF-123"));
        assert!(!is_valid_project_id(""));
        assert!(!is_valid_project_id("a b"));
        assert!(!is_valid_project_id("a/b"));
        assert!(!is_valid_project_id("a.b"));
    }

    #[test]
    fn entry_file_rules() {
        assert_eq!(entry_file_error("main.tex"), None);
        assert_eq!(entry_file_error("chapters/intro_1-2.tex"), None);
        assert_eq!(entry_file_error(""), Some(ENTRY_FILE_INVALID));
        assert_eq!(entry_file_error("/etc/passwd"), Some(ENTRY_FILE_INVALID));
        assert_eq!(entry_file_error("a/../b.tex"), Some(ENTRY_FILE_INVALID));
        assert_eq!(entry_file_error("a..b.tex"), Some(ENTRY_FILE_INVALID));
        assert_eq!(entry_file_error("my file.tex"), Some(ENTRY_FILE_INVALID));
    }

    #[test]
    fn parses_pasted_project_ids() {
        let id = "64f0c0ffee0123456789abcd";
        for raw in [
            id.to_owned(),
            format!("  {id}  "),
            format!("https://www.overleaf.com/project/{id}"),
            format!("https://overleaf.com/project/{id}/"),
            format!("https://www.overleaf.com/project/{id}?tab=1#x"),
            format!("https://git.overleaf.com/{id}"),
        ] {
            assert_eq!(
                parse_overleaf_project_id(&raw).as_deref(),
                Some(id),
                "{raw}"
            );
        }
        for raw in [
            String::new(),
            "has space".to_owned(),
            "../etc".to_owned(),
            format!("http://www.overleaf.com/project/{id}"),
            format!("https://evil.example/project/{id}"),
            format!("https://overleaf.com.evil.example/project/{id}"),
            format!("https://git:tok@git.overleaf.com/{id}"),
            format!("https://www.overleaf.com/project/{id}/settings"),
            format!("https://www.overleaf.com/read/{id}"),
            "https://git.overleaf.com/a/b".to_owned(),
            "https://git.overleaf.com/".to_owned(),
        ] {
            assert_eq!(parse_overleaf_project_id(&raw), None, "{raw}");
        }
        assert_eq!(
            overleaf_git_url(id),
            format!("https://git.overleaf.com/{id}")
        );
    }

    #[test]
    fn builds_external_url() {
        assert_eq!(
            external_url("abc123"),
            "https://www.overleaf.com/project/abc123"
        );
    }

    #[test]
    fn sanitize_rejects_non_objects() {
        assert!(sanitize_section_targets(&json!(null)).is_none());
        assert!(sanitize_section_targets(&json!([])).is_none());
        assert!(sanitize_section_targets(&json!("x")).is_none());
    }

    #[test]
    fn sanitize_rejects_bad_keys() {
        assert!(sanitize_section_targets(&json!({"": 1})).is_none());
        let long_key = "a".repeat(501);
        assert!(sanitize_section_targets(&json!({ long_key: 1 })).is_none());
        let max_key = "a".repeat(500);
        assert!(sanitize_section_targets(&json!({ max_key: 1 })).is_some());
    }

    #[test]
    fn sanitize_drops_null_values() {
        let out = sanitize_section_targets(&json!({"intro": null, "methods": 4})).unwrap();
        assert_eq!(out.len(), 1);
        assert_eq!(out.get("methods"), Some(&json!(4)));
    }

    #[test]
    fn sanitize_rejects_bad_values() {
        for bad in [
            json!(0),
            json!(-1),
            json!(10_000_001),
            json!(1.5),
            json!("5"),
        ] {
            assert!(sanitize_section_targets(&json!({ "s": bad })).is_none());
        }
    }

    #[test]
    fn sanitize_keeps_bounds_and_whole_floats() {
        let out = sanitize_section_targets(&json!({"a": 1, "b": 10_000_000, "c": 3.0})).unwrap();
        assert_eq!(out.get("a"), Some(&json!(1)));
        assert_eq!(out.get("b"), Some(&json!(10_000_000)));
        assert_eq!(out.get("c"), Some(&json!(3)));
    }
}
pub mod bibtex;
pub mod error_redact;
pub mod export_package;
pub mod export_path;
pub mod path_guard;
pub mod project_list;
pub mod report_statements;
pub mod sync_status;
pub mod thumb;
pub mod upload;
pub mod upload_reason;
