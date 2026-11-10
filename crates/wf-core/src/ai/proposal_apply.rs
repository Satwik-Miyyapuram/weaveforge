//! Whether an AI proposal still applies to the row it was written against. Pure.

/// Whether a proposal applies to the stored row. `stored_updated_at` is the row's `updatedAt`,
/// or `None` when the row is missing. An empty or absent expected revision counts as no
/// expectation, which the TS code always did. Port of `proposalApplies` in
/// `packages/core/src/features/ai-assistant/application/append-paper-note.use-case.ts`.
#[must_use]
pub fn proposal_applies(stored_updated_at: Option<&str>, expected_revision: Option<&str>) -> bool {
    let Some(stored) = stored_updated_at else {
        return false;
    };
    match expected_revision {
        Some(expected) if !expected.is_empty() => stored == expected,
        _ => true,
    }
}

#[cfg(test)]
mod tests {
    use super::proposal_applies;

    #[test]
    fn missing_row_never_applies() {
        assert!(!proposal_applies(None, Some("rev-1")));
        assert!(!proposal_applies(None, None));
    }

    #[test]
    fn no_expectation_applies_to_any_row() {
        assert!(proposal_applies(Some("rev-9"), None));
        assert!(proposal_applies(Some("rev-9"), Some("")));
    }

    #[test]
    fn expected_revision_must_match() {
        assert!(proposal_applies(Some("rev-9"), Some("rev-9")));
        assert!(!proposal_applies(Some("rev-9"), Some("rev-1")));
    }
}
