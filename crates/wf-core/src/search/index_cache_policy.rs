//! Port of the decision in `apps/web/src/features/search/infrastructure/parts-1.ts`.
//! Platform detection (`isInstalledApp`) and IndexedDB writes stay in TS; this is only the rule.

/// Documents past which a browser tab stops persisting its index. Single source for the web app
/// (read through `webCacheDocumentLimit`).
///
/// Chosen from the measured curve rather than a round number: at 5 000 documents the serialized
/// index is roughly 37 MB, which is the point where writing it starts to cost more than the
/// rebuild it saves.
pub const WEB_CACHE_DOCUMENT_LIMIT: usize = 5_000;

/// Persist when this is the installed app (any size), or the website within the limit.
#[must_use]
pub const fn should_persist_index(installed_app: bool, document_count: usize) -> bool {
    installed_app || document_count <= WEB_CACHE_DOCUMENT_LIMIT
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn installed_app_persists_any_size() {
        assert!(should_persist_index(true, WEB_CACHE_DOCUMENT_LIMIT * 10));
    }

    #[test]
    fn website_persists_up_to_and_including_the_limit() {
        assert!(should_persist_index(false, WEB_CACHE_DOCUMENT_LIMIT));
        assert!(!should_persist_index(false, WEB_CACHE_DOCUMENT_LIMIT + 1));
    }
}
