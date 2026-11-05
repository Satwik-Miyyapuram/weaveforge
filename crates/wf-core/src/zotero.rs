//! Zotero library rules: normalizing user-entered library ids into API path segments.

/// Normalize a library reference into `users/<id>` or `groups/<id>`, or `None` when it is not one.
///
/// A bare numeric id is treated as a user library.
#[must_use]
pub fn normalize_library(library: Option<&str>) -> Option<String> {
    let trimmed = library?.trim();
    if trimmed.is_empty() {
        return None;
    }
    if is_digits(trimmed) {
        return Some(format!("users/{trimmed}"));
    }
    let rest = trimmed
        .strip_prefix("users/")
        .or_else(|| trimmed.strip_prefix("groups/"))?;
    is_digits(rest).then(|| trimmed.to_owned())
}

/// Whether `s` is non-empty and made only of ASCII digits.
fn is_digits(s: &str) -> bool {
    !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit())
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    #[test]
    fn bare_digits_become_user_library() {
        assert_eq!(normalize_library(Some("123")), Some("users/123".to_owned()));
        assert_eq!(
            normalize_library(Some(" 123 ")),
            Some("users/123".to_owned())
        );
    }

    #[test]
    fn prefixed_libraries_are_kept() {
        assert_eq!(
            normalize_library(Some("users/5")),
            Some("users/5".to_owned())
        );
        assert_eq!(
            normalize_library(Some("groups/7")),
            Some("groups/7".to_owned())
        );
    }

    #[test]
    fn invalid_libraries_are_rejected() {
        assert_eq!(normalize_library(Some("users/")), None);
        assert_eq!(normalize_library(Some("orgs/5")), None);
        assert_eq!(normalize_library(Some("users/5/x")), None);
        assert_eq!(normalize_library(Some("")), None);
        assert_eq!(normalize_library(None), None);
    }
}
