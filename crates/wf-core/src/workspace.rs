//! Workspace path rules shared by every adapter: relative, normalized, never leaving the root.

/// Hidden folder inside a workspace that marks it as WeaveForge's.
pub const WORKSPACE_META_DIR: &str = ".weaveforge";

/// A path refused by [`safe_workspace_path`]; carries the original input.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UnsafePath(pub String);

impl std::fmt::Display for UnsafePath {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Unsafe workspace path: {}", self.0)
    }
}

impl std::error::Error for UnsafePath {}

/// Normalize a relative path and refuse anything that could leave the root.
///
/// Backslashes fold first so a zip written on Windows cannot carry `..\..\etc` past the check.
///
/// # Errors
/// Returns [`UnsafePath`] for empty, absolute, drive-prefixed, `..` or segmentless paths.
pub fn safe_workspace_path(path: &str) -> Result<String, UnsafePath> {
    let folded = path.replace('\\', "/");
    let normalized = folded.strip_prefix("./").unwrap_or(folded.as_str());
    let refuse = || UnsafePath(path.to_owned());
    if normalized.is_empty() || normalized.starts_with('/') {
        return Err(refuse());
    }
    let mut parts = Vec::new();
    for segment in normalized.split('/') {
        match segment {
            "" | "." => {}
            ".." => return Err(refuse()),
            // Checked on every segment: `././C:` hides a drive from a check on the whole path,
            // and on Windows joining any `C:` segment replaces the root.
            _ if has_drive_prefix(segment) => return Err(refuse()),
            _ => parts.push(segment),
        }
    }
    if parts.is_empty() {
        return Err(refuse());
    }
    Ok(parts.join("/"))
}

/// True when [`safe_workspace_path`] accepts the path; for filtering without an error.
#[must_use]
pub fn is_safe_workspace_path(path: &str) -> bool {
    safe_workspace_path(path).is_ok()
}

/// A Windows drive prefix such as `C:`; checked so `C:foo` is never treated as relative.
fn has_drive_prefix(path: &str) -> bool {
    let mut chars = path.chars();
    matches!((chars.next(), chars.next()), (Some(c), Some(':')) if c.is_ascii_alphabetic())
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    #[test]
    fn accepts_and_normalizes() {
        let cases = [
            ("notes/a.md", "notes/a.md"),
            ("./notes/a.md", "notes/a.md"),
            ("a//b/./c", "a/b/c"),
            ("a/b/", "a/b"),
            ("././a", "a"),
            ("a\\b\\c.md", "a/b/c.md"),
            ("...", "..."),
            ("a/..b/c", "a/..b/c"),
            ("notities/ü.md", "notities/ü.md"),
        ];
        for (input, expected) in cases {
            assert_eq!(
                safe_workspace_path(input),
                Ok(expected.to_owned()),
                "input: {input:?}"
            );
        }
    }

    #[test]
    fn refuses_unsafe_paths() {
        let cases = [
            "",
            ".",
            "./",
            "/",
            "//x",
            "/etc/passwd",
            "../../etc/passwd",
            "..\\..\\etc",
            "a/../../x",
            "a/..",
            "C:/Windows",
            "c:foo",
            "C:\\x",
            "\\\\server\\share\\x",
            // A drive behind more than one `./`, or in a later segment: on Windows
            // `Path::join` would replace the root with it.
            ".\\./a:",
            "././C:/x",
            "a/C:/x",
            "a/c:",
        ];
        for input in cases {
            assert!(safe_workspace_path(input).is_err(), "input: {input:?}");
            assert!(!is_safe_workspace_path(input), "input: {input:?}");
        }
    }

    #[test]
    fn error_carries_original_input() {
        let err = safe_workspace_path("../x").unwrap_err();
        assert_eq!(err, UnsafePath("../x".to_owned()));
        assert_eq!(err.to_string(), "Unsafe workspace path: ../x");
    }

    #[test]
    fn metadata_constant_is_dot_weaveforge() {
        assert_eq!(WORKSPACE_META_DIR, ".weaveforge");
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(256))]

        #[test]
        fn ok_output_is_safe_and_idempotent(input in "[a-z./\\\\:]{0,12}") {
            if let Ok(s) = safe_workspace_path(&input) {
                prop_assert!(!s.is_empty(), "input: {input:?}");
                prop_assert!(!s.starts_with('/'), "input: {input:?}");
                prop_assert!(!s.contains('\\'), "input: {input:?}");
                for seg in s.split('/') {
                    prop_assert!(seg != ".." && seg != "." && !seg.is_empty(), "input: {input:?}");
                }
                prop_assert_eq!(safe_workspace_path(&s), Ok(s.clone()));
            }
        }
    }
}
