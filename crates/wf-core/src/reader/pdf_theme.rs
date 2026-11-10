//! Whether PDF pages render dark (TS `shouldUseDarkPdfRendering`).
//! Port of `apps/web/src/features/reader/application/reader-pdf-theme.ts`.
//!
//! The dark-theme ids mirror `DARK_THEMES` in `apps/web/src/lib/theme/theme.ts`. Keep the two lists
//! in step: this copy is the one the Rust side reads, that one is the one the UI picks from.

/// Theme ids that count as dark (mirror of `DARK_THEMES` in `lib/theme/theme.ts`).
pub const DARK_THEME_IDS: [&str; 9] = [
    "brutal-dark",
    "dark",
    "mocha",
    "dracula",
    "amoled",
    "contrast",
    "vivid-dark",
    "pastel-dark",
    "confetti-dark",
];

/// Whether the app is in a dark theme: `mode` is `"dark"`, or `theme_id` names a dark theme.
/// An empty or absent theme id is never dark. PDF pages never follow this on their own: HTML
/// papers do, PDF pages always render light unless the caller says otherwise.
#[must_use]
pub fn should_use_dark_pdf_rendering(theme_id: Option<&str>, mode: Option<&str>) -> bool {
    if mode == Some("dark") {
        return true;
    }
    match theme_id {
        Some(id) if !id.is_empty() => DARK_THEME_IDS.contains(&id),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::should_use_dark_pdf_rendering;

    #[test]
    fn dark_mode_wins_over_any_theme() {
        assert!(should_use_dark_pdf_rendering(Some("light"), Some("dark")));
        assert!(should_use_dark_pdf_rendering(None, Some("dark")));
    }

    #[test]
    fn absent_or_empty_theme_is_light() {
        assert!(!should_use_dark_pdf_rendering(None, None));
        assert!(!should_use_dark_pdf_rendering(Some(""), Some("light")));
    }

    #[test]
    fn named_dark_theme_is_dark_and_unknown_is_not() {
        assert!(should_use_dark_pdf_rendering(Some("mocha"), None));
        assert!(!should_use_dark_pdf_rendering(Some("paper"), None));
    }
}
