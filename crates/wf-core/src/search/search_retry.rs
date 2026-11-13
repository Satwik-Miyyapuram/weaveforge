//! Second-chance fuzzy matching for a query that found nothing (TS
//! `search-retry.ts`). A query with results is never retried. Fuzziness rises by
//! exactly one edit, which is enough for a transposition (Damerau counts a swap
//! as one edit, Levenshtein as two).

use crate::search::js_text::utf16_len;
use crate::search::search_tuning::fuzziness_for_term;

/// Longest query worth retrying.
pub const MAX_RETRY_TERMS: usize = 4;

/// Shorter terms are not retried: one more edit matches much of the dictionary.
pub const MIN_RETRY_TERM_LENGTH: usize = 4;

/// Whether a second pass is worth making. Only a query with zero results, and
/// with 1 to `MAX_RETRY_TERMS` terms, is retried.
#[must_use]
pub fn should_retry(result_count: usize, term_count: usize) -> bool {
    result_count == 0 && term_count > 0 && term_count <= MAX_RETRY_TERMS
}

/// Absolute maximum edit distance for `term` on the retry pass, or 0 to leave
/// the term alone. Length is counted in UTF-16 units, as the TS did.
#[must_use]
pub fn retry_fuzziness_for_term(term: &str, retry: bool) -> f64 {
    if !retry || utf16_len(term) < MIN_RETRY_TERM_LENGTH {
        return 0.0;
    }
    let first_pass = (fuzziness_for_term(term) * utf16_len(term) as f64).round();
    first_pass + 1.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retries_only_failed_short_queries() {
        assert!(!should_retry(1, 1));
        assert!(!should_retry(50, 3));
        assert!(should_retry(0, 1));
        assert!(should_retry(0, 4));
        assert!(!should_retry(0, 5));
        assert!(!should_retry(0, 0));
    }

    #[test]
    fn short_terms_and_plain_pass_are_left_alone() {
        assert_eq!(retry_fuzziness_for_term("cat", true), 0.0);
        assert_eq!(retry_fuzziness_for_term("neural", false), 0.0);
    }

    #[test]
    fn retry_adds_one_edit_to_first_pass() {
        let term = "neural";
        let first = (fuzziness_for_term(term) * 6.0).round();
        assert_eq!(retry_fuzziness_for_term(term, true), first + 1.0);
    }
}
