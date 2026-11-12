//! Keys, key ranges and the storage budget of the stored PDF page text (wf-core `search::pdf_text_store`).
//! Ports the pure part of `apps/web/src/features/search/infrastructure/parts-2.ts`. The IndexedDB
//! reads, writes and cursor walks stay in TS and use the keys built here.

/// Guard against one pathological document filling the user's quota, in UTF-16 units like JS `length`.
pub const MAX_STORED_CHARS: usize = 2_000_000;

/// The IndexedDB key of one paper's stored text: the project first, so a project is a key prefix.
#[must_use]
pub fn store_key(project_id: Option<&str>, paper_id: &str) -> String {
    format!("{}|{paper_id}", project_id.unwrap_or("-"))
}

/// Inclusive `(lower, upper)` key bounds for every key of one project.
#[must_use]
pub fn project_range(project_id: Option<&str>) -> (String, String) {
    let prefix = format!("{}|", project_id.unwrap_or("-"));
    let upper = format!("{prefix}\u{ffff}");
    (prefix, upper)
}

/// How many leading pages fit the budget. A page that takes the running total past
/// [`MAX_STORED_CHARS`] ends the kept run, and it and every later page are dropped.
///
/// `page_char_lengths` are the pages' UTF-16 lengths, in order.
#[must_use]
pub fn budget_page_count(page_char_lengths: &[usize]) -> usize {
    let mut total = 0usize;
    let mut kept = 0usize;
    for len in page_char_lengths {
        total += len;
        if total > MAX_STORED_CHARS {
            break;
        }
        kept += 1;
    }
    kept
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn store_key_puts_the_project_first() {
        assert_eq!(store_key(Some("p1"), "a"), "p1|a");
        assert_eq!(store_key(None, "g"), "-|g");
    }

    #[test]
    fn project_range_bounds_only_that_project() {
        let (lower, upper) = project_range(Some("p1"));
        assert_eq!(lower, "p1|");
        assert!(store_key(Some("p1"), "zzz") >= lower);
        assert!(store_key(Some("p1"), "zzz") <= upper);
        assert!(store_key(Some("p10"), "c") < lower);
        assert!(store_key(Some("p2"), "d") > upper);
        let (none_lower, _) = project_range(None);
        assert_eq!(none_lower, "-|");
    }

    #[test]
    fn budget_keeps_every_page_under_the_cap() {
        assert_eq!(budget_page_count(&[10, 20, 30]), 3);
        assert_eq!(budget_page_count(&[]), 0);
    }

    #[test]
    fn budget_cuts_at_the_page_that_passes_the_cap() {
        let half = MAX_STORED_CHARS / 2;
        assert_eq!(budget_page_count(&[half, half, 1, 5]), 2);
        assert_eq!(budget_page_count(&[MAX_STORED_CHARS, 1]), 1);
    }

    #[test]
    fn budget_counts_the_page_that_lands_exactly_on_the_cap() {
        assert_eq!(budget_page_count(&[MAX_STORED_CHARS - 1, 1, 1]), 2);
    }
}
