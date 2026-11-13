//! What the explorer may create, rename and move, and where (ported from the
//! TypeScript `explorer-edit.ts`).
//!
//! The rules are per root: Notes and its folders take notes and folders, and a
//! note takes nothing (only a folder holds children). Report's sections nest,
//! because that is the report's outline. Papers take nothing: a paper arrives
//! through import.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use super::breadcrumbs::tree_kind_name;
use super::workspace_tree::{WorkspaceTreeNode, is_document_node};

/// The kinds a draft row can make.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "lowercase")]
pub enum CreateKind {
    /// A note.
    Note,
    /// A folder: a note made as a grouping row.
    Folder,
    /// A report section.
    Section,
}

/// Which root a row belongs to.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "lowercase")]
pub enum EditableRoot {
    /// Notes, and its folders.
    Notes,
    /// Report, and its sections.
    Report,
}

/// A document on screen, as the new-file gestures read it.
#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ActiveDocument {
    /// The tree kind of the document, as its snake_case name.
    pub kind: String,
    /// The parent note or section, when it has one.
    #[serde(default)]
    pub parent_id: Option<String>,
}

/// Where a draft lands: which root, and the parent (`None` for the root).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct CreationTarget {
    /// The root the draft goes under.
    pub root: EditableRoot,
    /// The parent id, or `None` for the top of the root.
    pub parent_id: Option<String>,
}

/// What a draft of each kind turns into.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct DraftMakes {
    /// Whether the note is handwritten.
    pub ink: bool,
    /// Whether the note is opened once it exists.
    pub opens: bool,
    /// Whether it is saved as a folder.
    pub folder: bool,
}

/// The key of a root's row in the tree (its directory name).
#[must_use]
pub const fn root_key(root: EditableRoot) -> &'static str {
    match root {
        EditableRoot::Notes => "notes",
        EditableRoot::Report => "report",
    }
}

/// The root a *kind* belongs to, by its snake_case name.
#[must_use]
pub fn root_of_kind(kind: &str) -> Option<EditableRoot> {
    match kind {
        "vault_page" | "ink_page" => Some(EditableRoot::Notes),
        "report_section" => Some(EditableRoot::Report),
        _ => None,
    }
}

/// The root a row sits under, by its key or its kind. A list member or an
/// outline heading is not editable.
#[must_use]
pub fn root_of(node: &WorkspaceTreeNode) -> Option<EditableRoot> {
    if node.is_member || node.heading_level.is_some() {
        return None;
    }
    if node.key == root_key(EditableRoot::Notes) {
        return Some(EditableRoot::Notes);
    }
    if node.key == root_key(EditableRoot::Report) {
        return Some(EditableRoot::Report);
    }
    root_of_kind(tree_kind_name(node.kind))
}

/// The kinds each root's rows may be given as children; the first is the default.
const fn creatable(root: EditableRoot) -> &'static [CreateKind] {
    match root {
        EditableRoot::Notes => &[CreateKind::Note, CreateKind::Folder],
        EditableRoot::Report => &[CreateKind::Section],
    }
}

/// In Notes only the root row and folders hold children; a report section holds sections.
fn holds_children(node: &WorkspaceTreeNode, root: EditableRoot) -> bool {
    root != EditableRoot::Notes || !is_document_node(node)
}

fn has_id(node: &WorkspaceTreeNode) -> bool {
    node.id.as_deref().is_some_and(|id| !id.is_empty())
}

/// The kinds a draft under `node` may take; empty for Papers, lists, headings and notes.
#[must_use]
pub fn creatable_under(node: &WorkspaceTreeNode) -> Vec<CreateKind> {
    match root_of(node) {
        Some(root) if holds_children(node, root) => creatable(root).to_vec(),
        _ => Vec::new(),
    }
}

/// The kind the "new file" gestures make while `active_kind` is the document on
/// screen: a note beside a note, a section beside a section, and Notes' own
/// first kind when the document lives under no editable root.
#[must_use]
pub fn creation_kind_for(active_kind: Option<&str>) -> CreateKind {
    let root = active_kind
        .and_then(root_of_kind)
        .unwrap_or(EditableRoot::Notes);
    creatable(root)[0]
}

/// Whether a row can be renamed in place: any note or section, never a root or a paper.
#[must_use]
pub fn can_rename(node: &WorkspaceTreeNode) -> bool {
    has_id(node) && root_of(node).is_some() && (is_document_node(node) || node.folder)
}

/// Where a "new file" from the head or `⌘N` lands: the folder of the document on
/// screen when that document lives under a root that takes the kind, otherwise the
/// top of Notes (or of Report, for a section). A note's parent counts only when it
/// is in `folders`.
#[must_use]
pub fn creation_target(
    kind: CreateKind,
    active: Option<&ActiveDocument>,
    folders: &HashSet<String>,
) -> CreationTarget {
    let root = if kind == CreateKind::Section {
        EditableRoot::Report
    } else {
        EditableRoot::Notes
    };
    if let Some(active) = active
        && let Some(parent) = active.parent_id.as_deref().filter(|p| !p.is_empty())
    {
        let same_root = root_of_kind(&active.kind) == Some(root);
        if same_root && (root != EditableRoot::Notes || folders.contains(parent)) {
            return CreationTarget {
                root,
                parent_id: Some(parent.to_owned()),
            };
        }
    }
    CreationTarget {
        root,
        parent_id: None,
    }
}

/// Whether `node` lies beneath `ancestor` in its subtree.
fn is_descendant(ancestor: &WorkspaceTreeNode, node: &WorkspaceTreeNode) -> bool {
    ancestor
        .children
        .iter()
        .any(|child| child.key == node.key || is_descendant(child, node))
}

/// Whether `source` may be dropped on `target`: same root, a target that holds
/// children, and not the source itself or anything beneath it.
#[must_use]
pub fn can_drop(source: &WorkspaceTreeNode, target: &WorkspaceTreeNode) -> bool {
    let Some(root) = root_of(source) else {
        return false;
    };
    if !has_id(source) || root_of(target) != Some(root) {
        return false;
    }
    if target.key == source.key {
        return false;
    }
    if is_document_node(target) && !has_id(target) {
        return false;
    }
    if !holds_children(target, root) {
        return false;
    }
    !is_descendant(source, target)
}

/// The parent id a drop on `target` gives: `None` for the root row.
#[must_use]
pub fn drop_parent_id(target: &WorkspaceTreeNode) -> Option<String> {
    if is_document_node(target) || target.folder {
        target.id.clone()
    } else {
        None
    }
}

/// The label a draft row's box shows as a hint.
#[must_use]
pub const fn draft_placeholder(kind: CreateKind) -> &'static str {
    match kind {
        CreateKind::Note => "Note title",
        CreateKind::Folder => "Folder name",
        CreateKind::Section => "Section title",
    }
}

/// The icon handle a draft row shows while it is being named. The handles are
/// the ones the tree uses, so the new row does not look like another species.
#[must_use]
pub const fn draft_icon(kind: CreateKind) -> &'static str {
    match kind {
        CreateKind::Note => "notes",
        CreateKind::Folder => "folder",
        CreateKind::Section => "doc",
    }
}

/// What a draft of each kind turns into. A folder is made and left closed.
#[must_use]
pub const fn draft_makes(kind: CreateKind) -> DraftMakes {
    match kind {
        CreateKind::Note | CreateKind::Section => DraftMakes {
            ink: false,
            opens: true,
            folder: false,
        },
        CreateKind::Folder => DraftMakes {
            ink: false,
            opens: false,
            folder: true,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::editor_workspace::workspace_tree::TreeNodeKind;

    fn node(key: &str, kind: TreeNodeKind, id: Option<&str>, folder: bool) -> WorkspaceTreeNode {
        WorkspaceTreeNode {
            key: key.to_owned(),
            kind,
            id: id.map(str::to_owned),
            label: String::new(),
            title: None,
            path: String::new(),
            children: Vec::new(),
            missing_note: false,
            is_member: false,
            inherited: false,
            inherited_from: None,
            heading_level: None,
            folder,
        }
    }

    #[test]
    fn root_of_reads_root_keys_and_kinds() {
        assert_eq!(
            root_of(&node("notes", TreeNodeKind::Folder, None, false)),
            Some(EditableRoot::Notes)
        );
        assert_eq!(
            root_of(&node("report", TreeNodeKind::Folder, None, false)),
            Some(EditableRoot::Report)
        );
        assert_eq!(
            root_of(&node(
                "ink_page:n3",
                TreeNodeKind::InkPage,
                Some("n3"),
                false
            )),
            Some(EditableRoot::Notes)
        );
        assert_eq!(
            root_of(&node("paper:p1", TreeNodeKind::Paper, Some("p1"), false)),
            None
        );
        let mut member = node("vault_page:n1", TreeNodeKind::VaultPage, Some("n1"), false);
        member.is_member = true;
        assert_eq!(root_of(&member), None);
    }

    #[test]
    fn only_notes_folders_and_report_hold_children() {
        let note = node("vault_page:n2", TreeNodeKind::VaultPage, Some("n2"), false);
        let folder = node("vault_page:n1", TreeNodeKind::VaultPage, Some("n1"), true);
        assert!(creatable_under(&note).is_empty());
        assert_eq!(
            creatable_under(&folder),
            vec![CreateKind::Note, CreateKind::Folder]
        );
        let section = node(
            "report_section:s2",
            TreeNodeKind::ReportSection,
            Some("s2"),
            false,
        );
        assert_eq!(creatable_under(&section), vec![CreateKind::Section]);
        let paper = node("paper:p1", TreeNodeKind::Paper, Some("p1"), false);
        assert!(creatable_under(&paper).is_empty());
    }

    #[test]
    fn creation_kind_defaults_to_note() {
        assert_eq!(creation_kind_for(None), CreateKind::Note);
        assert_eq!(creation_kind_for(Some("paper")), CreateKind::Note);
        assert_eq!(
            creation_kind_for(Some("report_section")),
            CreateKind::Section
        );
    }

    #[test]
    fn creation_target_refuses_a_note_nested_under_a_note() {
        let folders: HashSet<String> = HashSet::from(["n1".to_owned()]);
        let under_folder = ActiveDocument {
            kind: "vault_page".to_owned(),
            parent_id: Some("n1".to_owned()),
        };
        assert_eq!(
            creation_target(CreateKind::Note, Some(&under_folder), &folders),
            CreationTarget {
                root: EditableRoot::Notes,
                parent_id: Some("n1".to_owned())
            },
        );
        let under_note = ActiveDocument {
            kind: "vault_page".to_owned(),
            parent_id: Some("n2".to_owned()),
        };
        assert_eq!(
            creation_target(CreateKind::Note, Some(&under_note), &folders),
            CreationTarget {
                root: EditableRoot::Notes,
                parent_id: None
            },
        );
        let section_parent = ActiveDocument {
            kind: "report_section".to_owned(),
            parent_id: Some("s1".to_owned()),
        };
        assert_eq!(
            creation_target(CreateKind::Section, Some(&section_parent), &folders),
            CreationTarget {
                root: EditableRoot::Report,
                parent_id: Some("s1".to_owned())
            },
        );
    }

    #[test]
    fn drop_stays_within_root_and_never_loops() {
        let mut folder = node("vault_page:n1", TreeNodeKind::VaultPage, Some("n1"), true);
        let note = node("vault_page:n2", TreeNodeKind::VaultPage, Some("n2"), false);
        let ink = node("ink_page:n3", TreeNodeKind::InkPage, Some("n3"), false);
        assert!(can_drop(&ink, &folder), "into a folder");
        assert!(!can_drop(&ink, &note), "a note holds nothing");
        assert!(!can_drop(&folder, &folder), "itself");
        folder.children.push(note.clone());
        assert!(!can_drop(&folder, &note), "a note is not a drop target");
        let section = node(
            "report_section:s2",
            TreeNodeKind::ReportSection,
            Some("s2"),
            false,
        );
        assert!(!can_drop(&note, &section), "another root");
    }

    #[test]
    fn drop_parent_is_the_target_id_only_for_documents_and_folders() {
        let folder = node("vault_page:n1", TreeNodeKind::VaultPage, Some("n1"), true);
        assert_eq!(drop_parent_id(&folder), Some("n1".to_owned()));
        assert_eq!(
            drop_parent_id(&node("notes", TreeNodeKind::Folder, None, false)),
            None
        );
    }

    #[test]
    fn draft_tables() {
        assert_eq!(draft_icon(CreateKind::Section), "doc");
        assert_eq!(draft_placeholder(CreateKind::Folder), "Folder name");
        assert_eq!(
            draft_makes(CreateKind::Folder),
            DraftMakes {
                ink: false,
                opens: false,
                folder: true
            },
        );
        assert_eq!(
            draft_makes(CreateKind::Note),
            DraftMakes {
                ink: false,
                opens: true,
                folder: false
            },
        );
    }
}
