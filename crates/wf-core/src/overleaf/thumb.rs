//! Keeping an Overleaf project's card picture in local storage (wf-core `overleaf::thumb`).
//! Parity with the former TypeScript rules in
//! `apps/web/src/features/report/lib/parts.ts`.

/// The longest data URL kept in storage: about 300 KB. A page drawn at card size is far smaller.
pub const MAX_SAVED_CHARS: usize = 300_000;

const KEY_PREFIX: &str = "weaveforge.overleaf-thumb.";

/// The storage key for a project's picture.
#[must_use]
pub fn thumb_key(project_id: &str) -> String {
    format!("{KEY_PREFIX}{project_id}")
}

/// Whether a picture of `data_url_len` characters is kept. A bigger one is made again each time.
#[must_use]
pub fn fits_budget(data_url_len: usize) -> bool {
    data_url_len <= MAX_SAVED_CHARS
}

#[cfg(test)]
mod tests {
    use super::{MAX_SAVED_CHARS, fits_budget, thumb_key};

    #[test]
    fn key_is_prefixed_with_the_project_id() {
        assert_eq!(thumb_key("abc123"), "weaveforge.overleaf-thumb.abc123");
    }

    #[test]
    fn a_picture_at_the_limit_is_kept_and_one_over_is_not() {
        assert!(fits_budget(MAX_SAVED_CHARS));
        assert!(!fits_budget(MAX_SAVED_CHARS + 1));
        assert!(fits_budget(0));
    }
}
