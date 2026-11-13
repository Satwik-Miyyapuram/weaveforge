//! Breadcrumbs: where the document on screen sits, as a path. Ported from
//! `apps/web/src/features/editor-workspace/application/breadcrumbs.ts`.
//!
//! Crumbs are read off the tree the explorer already paints, so a breadcrumb
//! can never disagree with the sidebar. A document inside a reading list
//! follows the list; everything else follows the folder.

use serde::{Deserialize, Serialize};

use super::workspace_tree::{TreeNodeKind, WorkspaceTreeNode};

/// The document on screen: its entity kind and id.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct BreadcrumbTab {
    /// The entity kind, as the tab names it (`vault_page`, `ink_page`, ...).
    pub kind: String,
    /// The entity id.
    pub id: String,
}

/// One crumb in the path.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct Crumb {
    /// The text the crumb shows.
    pub label: String,
    /// `kind:id` when the crumb names a document that can be opened.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub key: Option<String>,
    /// Set on the final crumb, which is where the kind suffix is shown.
    #[serde(default, skip_serializing_if = "is_false")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub current: bool,
}

fn is_false(value: &bool) -> bool {
    !*value
}

/// The wire string for a tree row kind, as the TypeScript kind is written.
#[must_use]
pub const fn tree_kind_name(kind: TreeNodeKind) -> &'static str {
    match kind {
        TreeNodeKind::VaultPage => "vault_page",
        TreeNodeKind::InkPage => "ink_page",
        TreeNodeKind::Paper => "paper",
        TreeNodeKind::ReadingList => "reading_list",
        TreeNodeKind::ReportSection => "report_section",
        TreeNodeKind::Experiment => "experiment",
        TreeNodeKind::Milestone => "milestone",
        TreeNodeKind::LogEntry => "log_entry",
        TreeNodeKind::Folder => "folder",
        TreeNodeKind::PaperPdf => "paper_pdf",
        TreeNodeKind::Overleaf => "overleaf",
    }
}

/// The first node with `kind:id`, depth-first.
fn find_node<'a>(
    nodes: &'a [WorkspaceTreeNode],
    tab: &BreadcrumbTab,
) -> Option<&'a WorkspaceTreeNode> {
    for node in nodes {
        if tree_kind_name(node.kind) == tab.kind && node.id.as_deref() == Some(tab.id.as_str()) {
            return Some(node);
        }
        if let Some(found) = find_node(&node.children, tab) {
            return Some(found);
        }
    }
    None
}

/// The chain of nodes from a root down to the node keyed `target_key`, inclusive.
fn chain_to<'a>(
    nodes: &'a [WorkspaceTreeNode],
    target_key: &str,
) -> Option<Vec<&'a WorkspaceTreeNode>> {
    for node in nodes {
        if node.key == target_key {
            return Some(vec![node]);
        }
        if let Some(mut below) = chain_to(&node.children, target_key) {
            below.insert(0, node);
            return Some(below);
        }
    }
    None
}

/// The crumbs for a document.
///
/// A document in a list follows the list, because that is the context it was
/// opened from. A document in neither still gets its own label as one crumb,
/// and a document that is nowhere gets `Untitled`.
#[must_use]
pub fn breadcrumbs(
    tab: &BreadcrumbTab,
    files: &[WorkspaceTreeNode],
    lists: &[WorkspaceTreeNode],
) -> Vec<Crumb> {
    let in_list = find_node(lists, tab);
    let Some(target) = in_list.or_else(|| find_node(files, tab)) else {
        return vec![Crumb {
            label: "Untitled".to_owned(),
            key: None,
            current: true,
        }];
    };
    let Some(chain) = chain_to(if in_list.is_some() { lists } else { files }, &target.key)
        .filter(|chain| !chain.is_empty())
    else {
        return vec![Crumb {
            label: target.label.clone(),
            key: None,
            current: true,
        }];
    };

    let root = if in_list.is_some() {
        "Reading lists"
    } else {
        "Files"
    };
    let mut crumbs = vec![Crumb {
        label: root.to_owned(),
        key: None,
        current: false,
    }];
    let last = chain.len() - 1;
    for (index, node) in chain.iter().enumerate() {
        let key = node
            .id
            .as_deref()
            .filter(|id| !id.is_empty())
            .map(|id| format!("{}:{id}", tree_kind_name(node.kind)));
        crumbs.push(Crumb {
            label: node.label.clone(),
            key,
            current: index == last,
        });
    }
    crumbs
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn node(value: serde_json::Value) -> WorkspaceTreeNode {
        serde_json::from_value(value).expect("node fixture")
    }

    fn files() -> Vec<WorkspaceTreeNode> {
        vec![node(json!({
            "key": "vault_page:c", "kind": "folder", "label": "Ideas", "path": "ideas",
            "children": [{
                "key": "paper:p1", "kind": "paper", "id": "p1", "label": "Baselines",
                "path": "ideas/baselines", "children": []
            }]
        }))]
    }

    fn tab(kind: &str, id: &str) -> BreadcrumbTab {
        BreadcrumbTab {
            kind: kind.to_owned(),
            id: id.to_owned(),
        }
    }

    #[test]
    fn folder_path_with_current_last() {
        let crumbs = breadcrumbs(&tab("paper", "p1"), &files(), &[]);
        let labels: Vec<&str> = crumbs.iter().map(|c| c.label.as_str()).collect();
        assert_eq!(labels, ["Files", "Ideas", "Baselines"]);
        assert_eq!(crumbs[2].key.as_deref(), Some("paper:p1"));
        assert!(crumbs[2].current);
        assert!(!crumbs[0].current);
    }

    #[test]
    fn missing_document_is_untitled() {
        let crumbs = breadcrumbs(&tab("paper", "gone"), &files(), &[]);
        assert_eq!(crumbs.len(), 1);
        assert_eq!(crumbs[0].label, "Untitled");
        assert!(crumbs[0].current);
    }

    #[test]
    fn list_membership_wins_over_folder() {
        let lists = vec![node(json!({
            "key": "reading_list:l1", "kind": "reading_list", "id": "l1", "label": "Week 1",
            "path": "week-1", "children": [{
                "key": "paper:p1@l1", "kind": "paper", "id": "p1", "label": "Baselines",
                "path": "week-1/baselines", "children": [], "isMember": true
            }]
        }))];
        let crumbs = breadcrumbs(&tab("paper", "p1"), &files(), &lists);
        let labels: Vec<&str> = crumbs.iter().map(|c| c.label.as_str()).collect();
        assert_eq!(labels, ["Reading lists", "Week 1", "Baselines"]);
    }

    #[test]
    fn kind_names_match_wire_strings() {
        assert_eq!(tree_kind_name(TreeNodeKind::PaperPdf), "paper_pdf");
        assert_eq!(
            tree_kind_name(TreeNodeKind::ReportSection),
            "report_section"
        );
    }
}
