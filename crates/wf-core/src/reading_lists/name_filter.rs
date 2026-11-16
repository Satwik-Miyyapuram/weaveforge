//! The reading-list name filter (TS `PostgrestReadingListRepository.list`, `nameContains`).
//! Names are encrypted at rest, so the server cannot match them and the filter runs on the
//! decrypted names. The TS keeps the decision to filter at all (a missing or empty `nameContains`
//! returns every list); this module is the per-name match.

/// Whether `name` contains `needle`, ignoring case (TS `name.toLowerCase().includes(needle)`
/// with `needle` lowercased first). An empty `needle` matches every name, as the TS
/// `needle ? ... : all` check did, because an empty string is falsy there.
#[must_use]
pub fn name_contains(name: &str, needle: &str) -> bool {
    if needle.is_empty() {
        return true;
    }
    name.to_lowercase().contains(&needle.to_lowercase())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_a_substring_ignoring_case() {
        assert!(name_contains("Machine Learning", "learn"));
        assert!(name_contains("Machine Learning", "MACHINE"));
        assert!(!name_contains("Machine Learning", "vision"));
    }

    #[test]
    fn empty_needle_matches_every_name() {
        assert!(name_contains("Anything", ""));
        assert!(name_contains("", ""));
    }

    #[test]
    fn matches_non_ascii_names_by_unicode_lowercase() {
        assert!(name_contains("Ärger", "ärg"));
        assert!(name_contains("ÄRGER", "ärger"));
    }
}
