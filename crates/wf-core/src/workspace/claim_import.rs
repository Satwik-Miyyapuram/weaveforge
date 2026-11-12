//! The decision in `claimImportedFile` (`apps/web/src/features/workspace/application/parts-3.ts`):
//! stamp a hand-written file with the id it was imported as, and record its digest in the
//! manifest so the next mirror removes this copy.
//!
//! Reading the file, the manifest and writing both stay in TypeScript.

use indexmap::IndexMap;
use serde::Serialize;

use crate::sync::folder_mirror::claim_digest;
use crate::sync::stamp_workspace_id::stamp_workspace_id;

/// What to write when a file is claimed: the stamped text and the digests to record.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaimPlan {
    /// The file text with the claim stamp applied.
    pub stamped: String,
    /// The digests to record, keyed by name.
    pub digests: IndexMap<String, String>,
}

/// The claim for `path` holding `content`, or `None` when nothing should be written: the file
/// already carries an id (`stamp_workspace_id` returns `None`). `base` is the manifest's
/// current digests.
#[must_use]
pub fn plan_claim(
    content: &str,
    id: &str,
    path: &str,
    base: &IndexMap<String, String>,
) -> Option<ClaimPlan> {
    let stamped = stamp_workspace_id(content, id)?;
    let digests = claim_digest(base, path, &stamped);
    Some(ClaimPlan { stamped, digests })
}

#[cfg(test)]
mod tests {
    use super::*;

    // it: "a hand-written file is stamped with the id it was imported as"
    #[test]
    fn a_hand_written_file_is_stamped_with_the_id_it_was_imported_as() {
        let base = IndexMap::new();
        let plan = plan_claim("# My idea\n", "n1", "notes/My idea.md", &base).expect("claimed");
        assert!(plan.stamped.contains("n1"));
        assert!(plan.digests.contains_key("notes/My idea.md"));
    }

    // it: "a file that already carries an id is neither rewritten nor claimed"
    #[test]
    fn a_file_that_already_carries_an_id_is_neither_rewritten_nor_claimed() {
        let base = IndexMap::new();
        let content = "---\nweaveforge-id: n9\n---\n\nbody\n";
        assert_eq!(plan_claim(content, "n1", "notes/theirs.md", &base), None);
    }
}
