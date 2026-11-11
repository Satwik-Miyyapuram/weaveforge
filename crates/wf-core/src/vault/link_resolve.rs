//! Note-link rules: which existing note a `[[title]]` resolves to, and the message for link
//! targets that failed to load. Ports the pure parts of
//! `apps/web/src/features/vault/application/parts.ts` and `load-link-targets.ts`.

use crate::vault::page::normalize_title_key;

/// The index of the first existing title that matches `title` once both are normalised, or `None`
/// when no title matches or `title` normalises to an empty key.
#[must_use]
pub fn find_title_match(existing_titles: &[String], title: &str) -> Option<usize> {
    let key = normalize_title_key(title);
    if key.is_empty() {
        return None;
    }
    existing_titles
        .iter()
        .position(|existing| normalize_title_key(existing) == key)
}

/// The message naming link targets that failed to load, or `None` when none failed. The labels are
/// sorted, then joined with " and ". Sorting by UTF-8 bytes matches JavaScript's UTF-16 sort for
/// the ASCII labels the vault uses.
#[must_use]
pub fn link_targets_error(failed: &[String]) -> Option<String> {
    if failed.is_empty() {
        return None;
    }
    let mut labels = failed.to_vec();
    labels.sort();
    Some(format!(
        "Links to {} could not be loaded, so they may show as missing.",
        labels.join(" and ")
    ))
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    fn strings(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| (*s).to_owned()).collect()
    }

    #[test]
    fn finds_first_match_by_normalised_title() {
        let existing = strings(&["Alpha", " beta ", "BETA"]);
        assert_eq!(find_title_match(&existing, "Beta"), Some(1));
        assert_eq!(find_title_match(&existing, "gamma"), None);
    }

    #[test]
    fn blank_title_matches_nothing() {
        let existing = strings(&["", "  "]);
        assert_eq!(find_title_match(&existing, "   "), None);
    }

    #[test]
    fn no_failures_means_no_error() {
        assert_eq!(link_targets_error(&[]), None);
    }

    #[test]
    fn failed_labels_are_sorted_and_joined() {
        assert_eq!(
            link_targets_error(&strings(&["report sections", "papers"])).as_deref(),
            Some(
                "Links to papers and report sections could not be loaded, so they may show as missing."
            )
        );
        assert_eq!(
            link_targets_error(&strings(&["papers"])).as_deref(),
            Some("Links to papers could not be loaded, so they may show as missing.")
        );
    }
}
