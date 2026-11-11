//! Whether a report tree has any results table (TS `hasResultsTables` in
//! `apps/web/src/features/overleaf/application/parts.ts`). The export loads the
//! experiments only when this is true.

use serde::Deserialize;

use super::results_table_refs::parse_results_table_refs;

/// The part of a report section the presence check reads: its notes. A missing or null `notes`
/// counts as empty, the same as the TS `notes ?? ""`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
#[serde(default)]
pub struct TreeSection {
    /// The section's markdown notes, where `exptable:` references live.
    pub notes: Option<String>,
}

/// One node of the report section tree: a section and its child nodes.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
#[serde(default)]
pub struct TreeNode {
    /// The section this node holds.
    pub section: TreeSection,
    /// Child nodes, searched after this node's own notes.
    pub children: Vec<TreeNode>,
}

/// Whether any node in `nodes`, or any descendant, has an `exptable:` reference in its notes.
/// Each node's own notes are checked before its children, so the answer is the same as the TS
/// `some(...)` walk.
#[must_use]
pub fn has_results_tables(nodes: &[TreeNode]) -> bool {
    nodes.iter().any(|node| {
        let notes = node.section.notes.as_deref().unwrap_or("");
        !parse_results_table_refs(notes).is_empty() || has_results_tables(&node.children)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::report::results_table_refs::serialise_results_table_ref;

    fn table_note() -> String {
        serialise_results_table_ref(&["run-1".to_owned()], "Results")
    }

    fn node(notes: Option<String>, children: Vec<TreeNode>) -> TreeNode {
        TreeNode {
            section: TreeSection { notes },
            children,
        }
    }

    #[test]
    fn empty_tree_has_no_results_tables() {
        assert!(!has_results_tables(&[]));
    }

    #[test]
    fn plain_notes_and_missing_notes_have_no_results_tables() {
        let tree = vec![
            node(Some("Just prose.".to_owned()), vec![]),
            node(None, vec![]),
        ];
        assert!(!has_results_tables(&tree));
    }

    #[test]
    fn a_reference_in_a_top_level_section_is_found() {
        let tree = vec![node(Some(table_note()), vec![])];
        assert!(has_results_tables(&tree));
    }

    #[test]
    fn a_reference_only_in_a_child_is_found() {
        let tree = vec![node(None, vec![node(Some(table_note()), vec![])])];
        assert!(has_results_tables(&tree));
    }

    #[test]
    fn deserialises_a_tree_with_null_and_missing_notes() {
        let tree: Vec<TreeNode> = serde_json::from_str(
            r#"[
                {"section": {"notes": null}, "children": []},
                {"section": {}, "children": [{"section": {"notes": "x"}}]}
            ]"#,
        )
        .expect("null and missing notes must deserialise");
        assert!(!has_results_tables(&tree));
    }
}
