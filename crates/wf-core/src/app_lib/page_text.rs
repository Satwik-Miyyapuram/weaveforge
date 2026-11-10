//! Page body fallbacks for list and search rows (TS `noteBodyText` and `isHydratedPage` in
//! `apps/web/src/lib/page-text.ts`).

/// The full body when it is non-empty, else the preview, else empty.
#[must_use]
pub fn body_text<'a>(body: Option<&'a str>, body_preview: Option<&'a str>) -> &'a str {
    match body {
        Some(full) if !full.is_empty() => full,
        _ => body_preview.unwrap_or(""),
    }
}

/// A page is hydrated when it carries a body and no non-empty preview stands in for it.
#[must_use]
pub fn is_hydrated_page(body: Option<&str>, body_preview: Option<&str>) -> bool {
    body.is_some() && body_preview.unwrap_or("").is_empty()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn body_wins_over_preview() {
        assert_eq!(body_text(Some("full"), Some("short")), "full");
    }

    #[test]
    fn empty_body_falls_back_to_preview() {
        assert_eq!(body_text(Some(""), Some("short")), "short");
        assert_eq!(body_text(None, Some("short")), "short");
    }

    #[test]
    fn nothing_gives_empty_text() {
        assert_eq!(body_text(None, None), "");
        assert_eq!(body_text(Some(""), Some("")), "");
    }

    #[test]
    fn hydrated_needs_body_and_no_preview() {
        assert!(is_hydrated_page(Some("x"), None));
        assert!(is_hydrated_page(Some(""), Some("")));
        assert!(!is_hydrated_page(Some("x"), Some("y")));
        assert!(!is_hydrated_page(None, None));
        assert!(!is_hydrated_page(None, Some("y")));
    }
}
