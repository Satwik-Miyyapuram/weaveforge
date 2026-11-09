//! The pane layout: a binary tree of splits with tab bars at the leaves.
//! Port of `application/pane-tree.ts`. Pure: every function maps a layout to a
//! new layout. New pane ids arrive as arguments; the TS glue generates them.
//!
//! A tab holds `{kind, id}`, never a path (see `workspace_tree`).

use std::collections::{BTreeMap, HashSet};

use serde::{Deserialize, Serialize};

use super::tab_groups::{TabGroup, TabGroupCommand, apply_group_command, without_group};

/// Which view a tab is in. The shipped editor is Edit and stays the default.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "lowercase")]
pub enum DocumentMode {
    #[default]
    /// Editable document view.
    Edit,
    /// Read-only document view.
    Read,
    /// Ink annotation view.
    Ink,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
/// One open tab: the document kind and id it shows, plus its remembered mode and group.
pub struct TabRef {
    /// Document kind, for example vault_page.
    pub kind: String,
    /// Id of the document within its kind.
    pub id: String,
    /// Remembered per tab. Absent means the tab was never switched.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mode: Option<DocumentMode>,
    /// Id of a group in the same pane.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
/// A pane: its id, its tabs, and the index of its active tab.
pub struct PaneLeaf {
    /// Pane id, unique within the layout.
    pub id: String,
    /// Tabs in this pane, in display order.
    pub tabs: Vec<TabRef>,
    /// Index into `tabs`; clamped by every operation, never trusted on read.
    pub active_index: i32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    /// Tab groups in this pane, when any exist.
    pub groups: Option<Vec<TabGroup>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "lowercase")]
/// Axis a split divides along.
pub enum SplitDirection {
    /// Children sit side by side.
    Row,
    /// Children are stacked top and bottom.
    Column,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
/// A split node: two children along one axis, sized by ratio.
pub struct PaneSplit {
    /// Axis the two children share.
    pub direction: SplitDirection,
    /// First child's share of the axis, 0.1–0.9 so neither side can vanish.
    pub ratio: f64,
    /// The first and second child nodes.
    pub children: (Box<PaneNode>, Box<PaneNode>),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(tag = "type", rename_all = "lowercase")]
/// A node in the pane tree: a leaf pane or a split of two nodes.
pub enum PaneNode {
    /// A leaf pane holding tabs.
    Leaf(PaneLeaf),
    /// A split of two child nodes.
    Split(PaneSplit),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
/// The whole layout: the pane tree and the focused pane id.
pub struct PaneLayout {
    /// Root node of the pane tree.
    pub root: PaneNode,
    /// Id of the pane that has focus.
    pub focused_pane_id: String,
}

/// The pane chords: each acts on the focused pane's active tab.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub enum PaneCommand {
    #[serde(rename = "split-right")]
    /// Split the focused pane to the right.
    SplitRight,
    #[serde(rename = "close-tab")]
    /// Close the active tab.
    CloseTab,
    #[serde(rename = "next-tab")]
    /// Activate the next tab.
    NextTab,
    #[serde(rename = "previous-tab")]
    /// Activate the previous tab.
    PreviousTab,
    #[serde(rename = "toggle-mode")]
    /// Toggle the active tab document mode.
    ToggleMode,
    #[serde(rename = "tab-1")]
    /// Activate tab 1.
    Tab1,
    #[serde(rename = "tab-2")]
    /// Activate tab 2.
    Tab2,
    #[serde(rename = "tab-3")]
    /// Activate tab 3.
    Tab3,
    #[serde(rename = "tab-4")]
    /// Activate tab 4.
    Tab4,
    #[serde(rename = "tab-5")]
    /// Activate tab 5.
    Tab5,
    #[serde(rename = "tab-6")]
    /// Activate tab 6.
    Tab6,
    #[serde(rename = "tab-7")]
    /// Activate tab 7.
    Tab7,
    #[serde(rename = "tab-8")]
    /// Activate tab 8.
    Tab8,
    #[serde(rename = "last-tab")]
    /// Activate the last tab.
    LastTab,
}

impl PaneCommand {
    /// The 1-based position a `tab-N` chord points at.
    fn tab_position(self) -> Option<i32> {
        match self {
            Self::Tab1 => Some(1),
            Self::Tab2 => Some(2),
            Self::Tab3 => Some(3),
            Self::Tab4 => Some(4),
            Self::Tab5 => Some(5),
            Self::Tab6 => Some(6),
            Self::Tab7 => Some(7),
            Self::Tab8 => Some(8),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "kebab-case")]
/// Actions in a tab right-click menu.
pub enum TabMenuAction {
    /// Close this tab.
    Close,
    /// Close the other tabs.
    CloseOthers,
    /// Close the tabs to the right of this one.
    CloseRight,
    /// Split the pane to the right.
    SplitRight,
    /// Split the pane downward.
    SplitDown,
}

/// The items of a tab's right-click menu, as VS Code names them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(untagged)]
pub enum TabMenuCommand {
    /// A plain tab menu action.
    Action(TabMenuAction),
    /// A tab group command.
    Group(TabGroupCommand),
}

const MIN_RATIO: f64 = 0.1;
const MAX_RATIO: f64 = 0.9;
/// The pane a fresh layout starts with.
pub const DEFAULT_PANE_ID: &str = "pane-1";
/// The preview tab: one tab, not tied to a document (VS Code's "Open Preview to the Side").
pub const PREVIEW_KIND: &str = "preview";

#[must_use]
/// The stable key for a tab: its kind and id joined by a colon.
pub fn tab_key(tab: &TabRef) -> String {
    format!("{}:{}", tab.kind, tab.id)
}

#[must_use]
/// A fresh preview tab, not tied to any document.
pub fn preview_tab() -> TabRef {
    TabRef {
        kind: PREVIEW_KIND.to_owned(),
        id: "active".to_owned(),
        mode: None,
        group: None,
    }
}

#[must_use]
/// A layout holding one empty pane with the given id.
pub fn empty_layout(pane_id: &str) -> PaneLayout {
    PaneLayout {
        root: PaneNode::Leaf(PaneLeaf {
            id: pane_id.to_owned(),
            tabs: Vec::new(),
            active_index: 0,
            groups: None,
        }),
        focused_pane_id: pane_id.to_owned(),
    }
}

/// Every leaf, left to right.
#[must_use]
pub fn leaves(node: &PaneNode) -> Vec<&PaneLeaf> {
    match node {
        PaneNode::Leaf(leaf) => vec![leaf],
        PaneNode::Split(split) => {
            let mut out = leaves(&split.children.0);
            out.extend(leaves(&split.children.1));
            out
        }
    }
}

fn find_leaf<'a>(node: &'a PaneNode, pane_id: &str) -> Option<&'a PaneLeaf> {
    leaves(node).into_iter().find(|leaf| leaf.id == pane_id)
}

fn tab_at_leaf(leaf: &PaneLeaf, index: i32) -> Option<&TabRef> {
    usize::try_from(index).ok().and_then(|i| leaf.tabs.get(i))
}

fn clamp_index(leaf: PaneLeaf) -> PaneLeaf {
    let max = (leaf.tabs.len() as i32 - 1).max(0);
    PaneLeaf {
        active_index: leaf.active_index.clamp(0, max),
        ..leaf
    }
}

/// Rebuild the tree with one leaf replaced. `None` from `next` removes the leaf.
fn replace_leaf(
    node: &PaneNode,
    pane_id: &str,
    next: &mut dyn FnMut(&PaneLeaf) -> Option<PaneNode>,
) -> Option<PaneNode> {
    match node {
        PaneNode::Leaf(leaf) => {
            if leaf.id == pane_id {
                next(leaf)
            } else {
                Some(node.clone())
            }
        }
        PaneNode::Split(split) => {
            let first = replace_leaf(&split.children.0, pane_id, next);
            let second = replace_leaf(&split.children.1, pane_id, next);
            // A split with one surviving child is not a split: it collapses.
            match (first, second) {
                (None, survivor) | (survivor, None) => survivor,
                (Some(first), Some(second)) => Some(PaneNode::Split(PaneSplit {
                    direction: split.direction,
                    ratio: split.ratio,
                    children: (Box::new(first), Box::new(second)),
                })),
            }
        }
    }
}

fn with_root(layout: &PaneLayout, root: Option<PaneNode>) -> PaneNode {
    root.unwrap_or_else(|| layout.root.clone())
}

/// Keep focus on a pane that still exists; the first one when it does not.
fn settle_focus(root: PaneNode, preferred: &str) -> PaneLayout {
    let focused_pane_id = if find_leaf(&root, preferred).is_some() {
        preferred.to_owned()
    } else {
        leaves(&root).first().map_or_else(|| preferred.to_owned(), |leaf| leaf.id.clone())
    };
    PaneLayout {
        root,
        focused_pane_id,
    }
}

fn leaf_node(leaf: PaneLeaf) -> Option<PaneNode> {
    Some(PaneNode::Leaf(leaf))
}

/// Show `tab` in a pane, focusing it if it is already open there (no duplicates).
#[must_use]
pub fn open_tab(layout: &PaneLayout, tab: &TabRef, pane_id: &str) -> PaneLayout {
    let key = tab_key(tab);
    let root = replace_leaf(&layout.root, pane_id, &mut |leaf| {
        if let Some(existing) = leaf.tabs.iter().position(|open| tab_key(open) == key) {
            return leaf_node(PaneLeaf {
                active_index: existing as i32,
                ..leaf.clone()
            });
        }
        let mut tabs = leaf.tabs.clone();
        tabs.push(tab.clone());
        leaf_node(PaneLeaf {
            active_index: leaf.tabs.len() as i32,
            tabs,
            ..leaf.clone()
        })
    });
    settle_focus(with_root(layout, root), pane_id)
}

#[must_use]
/// Make the tab at index active in the pane, clamping the index to the tab range.
pub fn activate_tab(layout: &PaneLayout, pane_id: &str, index: i32) -> PaneLayout {
    let root = replace_leaf(&layout.root, pane_id, &mut |leaf| {
        leaf_node(clamp_index(PaneLeaf {
            active_index: index,
            ..leaf.clone()
        }))
    });
    settle_focus(with_root(layout, root), pane_id)
}

/// Close one tab. The last tab of a pane closes the pane, unless it is the only pane.
#[must_use]
pub fn close_tab(layout: &PaneLayout, pane_id: &str, index: i32) -> PaneLayout {
    let only_pane = leaves(&layout.root).len() == 1;
    let root = replace_leaf(&layout.root, pane_id, &mut |leaf| {
        let tabs: Vec<TabRef> = leaf
            .tabs
            .iter()
            .enumerate()
            .filter(|(i, _)| *i as i32 != index)
            .map(|(_, t)| t.clone())
            .collect();
        if tabs.is_empty() && !only_pane {
            return None;
        }
        // Closing the active tab lands on the one that took its place, or the last one.
        let active_index = if leaf.active_index > index {
            leaf.active_index - 1
        } else {
            leaf.active_index
        };
        leaf_node(clamp_index(PaneLeaf {
            tabs,
            active_index,
            ..leaf.clone()
        }))
    });
    settle_focus(with_root(layout, root), pane_id)
}

/// Split a pane in two, moving its active tab into the new half (ratio 0.5).
#[must_use]
pub fn split_pane(layout: &PaneLayout, pane_id: &str, direction: SplitDirection, new_pane_id: &str) -> PaneLayout {
    let Some(source) = find_leaf(&layout.root, pane_id) else {
        return layout.clone();
    };
    let carried = tab_at_leaf(source, source.active_index).map(without_group);
    let root = replace_leaf(&layout.root, pane_id, &mut |leaf| {
        let created = PaneLeaf {
            id: new_pane_id.to_owned(),
            tabs: carried.clone().into_iter().collect(),
            active_index: 0,
            groups: None,
        };
        Some(PaneNode::Split(PaneSplit {
            direction,
            ratio: 0.5,
            children: (Box::new(PaneNode::Leaf(leaf.clone())), Box::new(PaneNode::Leaf(created))),
        }))
    });
    PaneLayout {
        root: with_root(layout, root),
        focused_pane_id: new_pane_id.to_owned(),
    }
}

/// Put `tab` at `index` in the strip (clamped) and make it the active one.
fn insert_at(layout: &PaneLayout, pane_id: &str, tab: &TabRef, index: i32) -> PaneLayout {
    let root = replace_leaf(&layout.root, pane_id, &mut |leaf| {
        let at = index.clamp(0, leaf.tabs.len() as i32) as usize;
        let mut tabs = leaf.tabs.clone();
        tabs.insert(at, tab.clone());
        leaf_node(PaneLeaf {
            tabs,
            active_index: at as i32,
            ..leaf.clone()
        })
    });
    settle_focus(with_root(layout, root), pane_id)
}

/// Move a tab between panes (or within one), preserving the document itself.
/// With `to_index` the tab lands at that slot; without it, it goes last (or is
/// only shown when it is already there).
#[must_use]
pub fn move_tab(
    layout: &PaneLayout,
    from_pane_id: &str,
    from_index: i32,
    to_pane_id: &str,
    to_index: Option<i32>,
) -> PaneLayout {
    let Some(dragged) = find_leaf(&layout.root, from_pane_id)
        .and_then(|leaf| tab_at_leaf(leaf, from_index))
        .cloned()
    else {
        return layout.clone();
    };
    // A group belongs to its pane: within it the tab keeps it, elsewhere it drops it.
    let same_pane = from_pane_id == to_pane_id;
    let tab = if same_pane { dragged } else { without_group(&dragged) };

    if same_pane {
        let Some(to_index) = to_index else {
            return activate_tab(layout, to_pane_id, from_index);
        };
        let root = replace_leaf(&layout.root, to_pane_id, &mut |leaf| {
            leaf_node(PaneLeaf {
                tabs: leaf
                    .tabs
                    .iter()
                    .enumerate()
                    .filter(|(i, _)| *i as i32 != from_index)
                    .map(|(_, t)| t.clone())
                    .collect(),
                ..leaf.clone()
            })
        });
        let settled = settle_focus(with_root(layout, root), to_pane_id);
        return insert_at(&settled, to_pane_id, &tab, to_index);
    }

    let closed = close_tab(layout, from_pane_id, from_index);
    let already = find_leaf(&closed.root, to_pane_id)
        .is_some_and(|target| target.tabs.iter().any(|open| tab_key(open) == tab_key(&tab)));
    let opened = match to_index {
        Some(index) if !already => insert_at(&closed, to_pane_id, &tab, index),
        _ => open_tab(&closed, &tab, to_pane_id),
    };
    PaneLayout {
        focused_pane_id: to_pane_id.to_owned(),
        ..opened
    }
}

/// Set a split's first-child share, clamped to 0.1–0.9. A split is matched by its
/// direction and children: pane ids are unique, so that names one split.
#[must_use]
pub fn set_ratio(layout: &PaneLayout, target: &PaneSplit, ratio: f64) -> PaneLayout {
    let clamped = ratio.clamp(MIN_RATIO, MAX_RATIO);
    fn rewrite(node: &PaneNode, target: &PaneSplit, clamped: f64) -> PaneNode {
        match node {
            PaneNode::Leaf(_) => node.clone(),
            PaneNode::Split(split) => {
                if split.direction == target.direction && split.children == target.children {
                    return PaneNode::Split(PaneSplit {
                        ratio: clamped,
                        ..split.clone()
                    });
                }
                PaneNode::Split(PaneSplit {
                    children: (
                        Box::new(rewrite(&split.children.0, target, clamped)),
                        Box::new(rewrite(&split.children.1, target, clamped)),
                    ),
                    ..split.clone()
                })
            }
        }
    }
    PaneLayout {
        root: rewrite(&layout.root, target, clamped),
        focused_pane_id: layout.focused_pane_id.clone(),
    }
}

#[must_use]
/// Focus the pane with the given id; return the layout unchanged when no such pane exists.
pub fn focus_pane(layout: &PaneLayout, pane_id: &str) -> PaneLayout {
    if find_leaf(&layout.root, pane_id).is_some() {
        PaneLayout {
            focused_pane_id: pane_id.to_owned(),
            ..layout.clone()
        }
    } else {
        layout.clone()
    }
}

/// The tab a pane is showing, if any.
#[must_use]
pub fn active_tab(leaf: &PaneLeaf) -> Option<&TabRef> {
    tab_at_leaf(leaf, leaf.active_index)
}

/// The tab the focused pane is showing: the one the screen is "on".
#[must_use]
pub fn active_tab_ref(layout: &PaneLayout) -> Option<TabRef> {
    find_leaf(&layout.root, &layout.focused_pane_id)
        .and_then(active_tab)
        .cloned()
}

/// The key of the document on screen (the focused pane's active tab).
#[must_use]
pub fn active_tab_key(layout: &PaneLayout) -> Option<String> {
    active_tab_ref(layout).as_ref().map(tab_key)
}

/// The mode a tab is in. Tabs that predate modes are Edit; ink notes and PDF rows default to Ink.
#[must_use]
pub fn tab_mode(tab: &TabRef) -> DocumentMode {
    tab.mode.unwrap_or(if tab.kind == "ink_page" || tab.kind == "paper_pdf" {
        DocumentMode::Ink
    } else {
        DocumentMode::Edit
    })
}

/// The tab at a pane-and-index, or `None` when either is gone.
#[must_use]
pub fn tab_at(layout: &PaneLayout, pane_id: &str, index: i32) -> Option<TabRef> {
    find_leaf(&layout.root, pane_id)
        .and_then(|leaf| tab_at_leaf(leaf, index))
        .cloned()
}

/// Put one document into Edit or Read or Ink, in every pane where it is open.
/// Writes the mode explicitly, even when it matches the default. Unchanged when nothing matched.
#[must_use]
pub fn set_tab_mode(layout: &PaneLayout, target: &TabRef, mode: DocumentMode) -> PaneLayout {
    let key = tab_key(target);
    fn rewrite(node: &PaneNode, key: &str, mode: DocumentMode, changed: &mut bool) -> PaneNode {
        match node {
            PaneNode::Leaf(leaf) => {
                if !leaf.tabs.iter().any(|t| tab_key(t) == key && t.mode != Some(mode)) {
                    return node.clone();
                }
                *changed = true;
                PaneNode::Leaf(PaneLeaf {
                    tabs: leaf
                        .tabs
                        .iter()
                        .map(|t| {
                            if tab_key(t) == key {
                                TabRef {
                                    mode: Some(mode),
                                    ..t.clone()
                                }
                            } else {
                                t.clone()
                            }
                        })
                        .collect(),
                    ..leaf.clone()
                })
            }
            PaneNode::Split(split) => PaneNode::Split(PaneSplit {
                children: (
                    Box::new(rewrite(&split.children.0, key, mode, changed)),
                    Box::new(rewrite(&split.children.1, key, mode, changed)),
                ),
                ..split.clone()
            }),
        }
    }
    let mut changed = false;
    let root = rewrite(&layout.root, &key, mode, &mut changed);
    if changed {
        PaneLayout {
            root,
            focused_pane_id: layout.focused_pane_id.clone(),
        }
    } else {
        layout.clone()
    }
}

fn is_preview_tab(tab: &TabRef) -> bool {
    tab.kind == PREVIEW_KIND
}

fn preview_host(layout: &PaneLayout) -> Option<(String, i32)> {
    leaves(&layout.root).into_iter().find_map(|leaf| {
        leaf.tabs
            .iter()
            .position(is_preview_tab)
            .map(|index| (leaf.id.clone(), index as i32))
    })
}

#[must_use]
/// Whether a preview tab is open in any pane.
pub fn preview_open(layout: &PaneLayout) -> bool {
    preview_host(layout).is_some()
}

/// Open the preview in a new pane to the right of the focused one, keeping focus on
/// the document; or, when it is open anywhere, close it.
#[must_use]
pub fn toggle_preview(layout: &PaneLayout, new_pane_id: &str) -> PaneLayout {
    if let Some((pane, index)) = preview_host(layout) {
        return close_tab(layout, &pane, index);
    }
    let pane = layout.focused_pane_id.clone();
    let root = replace_leaf(&layout.root, &pane, &mut |leaf| {
        Some(PaneNode::Split(PaneSplit {
            direction: SplitDirection::Row,
            ratio: 0.5,
            children: (
                Box::new(PaneNode::Leaf(leaf.clone())),
                Box::new(PaneNode::Leaf(PaneLeaf {
                    id: new_pane_id.to_owned(),
                    tabs: vec![preview_tab()],
                    active_index: 0,
                    groups: None,
                })),
            ),
        }))
    });
    settle_focus(with_root(layout, root), &pane)
}

/// The document the preview shows: the focused tab, unless that is the preview
/// itself, in which case it keeps showing `previous`.
#[must_use]
pub fn preview_source(layout: &PaneLayout, previous: Option<&TabRef>) -> Option<TabRef> {
    active_tab_ref(layout)
        .filter(|tab| !is_preview_tab(tab))
        .or_else(|| previous.cloned())
}

/// The key of every tab open in any pane, each once, left to right.
#[must_use]
pub fn open_tab_keys(layout: &PaneLayout) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut keys = Vec::new();
    for leaf in leaves(&layout.root) {
        for tab in &leaf.tabs {
            let key = tab_key(tab);
            if seen.insert(key.clone()) {
                keys.push(key);
            }
        }
    }
    keys
}

/// Tabs open in `before` and in no pane of `after`, in the order they were shown.
#[must_use]
pub fn closed_tabs(before: &PaneLayout, after: &PaneLayout) -> Vec<TabRef> {
    let still: HashSet<String> = open_tab_keys(after).into_iter().collect();
    let mut seen = HashSet::new();
    let mut closed = Vec::new();
    for leaf in leaves(&before.root) {
        for tab in &leaf.tabs {
            let key = tab_key(tab);
            if still.contains(&key) || seen.contains(&key) {
                continue;
            }
            let _ = seen.insert(key);
            closed.push(tab.clone());
        }
    }
    closed
}

/// The focused pane's tab count: what a tab chord can point at.
#[must_use]
pub fn focused_tab_count(layout: &PaneLayout) -> i32 {
    find_leaf(&layout.root, &layout.focused_pane_id).map_or(0, |leaf| leaf.tabs.len() as i32)
}

/// The layout after one pane chord, acting on the focused pane.
#[must_use]
pub fn layout_for_command(layout: &PaneLayout, command: PaneCommand, new_pane_id: &str) -> PaneLayout {
    let pane = layout.focused_pane_id.clone();
    if command == PaneCommand::SplitRight {
        return split_pane(layout, &pane, SplitDirection::Row, new_pane_id);
    }
    let Some(leaf) = find_leaf(&layout.root, &pane) else {
        return layout.clone();
    };
    if leaf.tabs.is_empty() {
        return layout.clone();
    }
    let len = leaf.tabs.len() as i32;
    match command {
        PaneCommand::CloseTab => close_tab(layout, &pane, leaf.active_index),
        // Toggle mode (cmd-E) is Split: the preview beside the document, and again to close it.
        PaneCommand::ToggleMode => toggle_preview(layout, new_pane_id),
        PaneCommand::LastTab => activate_tab(layout, &pane, len - 1),
        PaneCommand::NextTab | PaneCommand::PreviousTab => {
            // Cycling wraps: Ctrl-Tab on the last tab lands on the first.
            let step = if command == PaneCommand::NextTab { 1 } else { -1 };
            activate_tab(layout, &pane, (leaf.active_index + step).rem_euclid(len))
        }
        PaneCommand::SplitRight => unreachable!("handled above"),
        tab => {
            // A position past the last tab is a miss, not "the last one".
            let index = tab.tab_position().unwrap_or(0) - 1;
            if index < len {
                activate_tab(layout, &pane, index)
            } else {
                layout.clone()
            }
        }
    }
}

/// The layout after a tab's right-click item, in one step.
#[must_use]
pub fn layout_for_tab_menu(
    layout: &PaneLayout,
    pane_id: &str,
    index: i32,
    command: &TabMenuCommand,
    new_pane_id: &str,
) -> PaneLayout {
    let Some(leaf) = find_leaf(&layout.root, pane_id) else {
        return layout.clone();
    };
    let Some(clicked) = tab_at_leaf(leaf, index).cloned() else {
        return layout.clone();
    };
    match command {
        TabMenuCommand::Group(group) => {
            let next = apply_group_command(leaf, index, group);
            if next == *leaf {
                return layout.clone();
            }
            let root = replace_leaf(&layout.root, pane_id, &mut |_| leaf_node(next.clone()));
            settle_focus(with_root(layout, root), pane_id)
        }
        TabMenuCommand::Action(TabMenuAction::Close) => close_tab(layout, pane_id, index),
        // A split carries the active tab, so the clicked tab becomes active first.
        TabMenuCommand::Action(TabMenuAction::SplitRight) => split_pane(
            &activate_tab(layout, pane_id, index),
            pane_id,
            SplitDirection::Row,
            new_pane_id,
        ),
        TabMenuCommand::Action(TabMenuAction::SplitDown) => split_pane(
            &activate_tab(layout, pane_id, index),
            pane_id,
            SplitDirection::Column,
            new_pane_id,
        ),
        TabMenuCommand::Action(TabMenuAction::CloseRight) if index as usize == leaf.tabs.len() - 1 => layout.clone(),
        TabMenuCommand::Action(action) => {
            let close_others = *action == TabMenuAction::CloseOthers;
            let root = replace_leaf(&layout.root, pane_id, &mut |current| {
                let next = if close_others {
                    PaneLeaf {
                        tabs: vec![clicked.clone()],
                        active_index: 0,
                        ..current.clone()
                    }
                } else {
                    PaneLeaf {
                        tabs: current.tabs[..=(index as usize)].to_vec(),
                        active_index: current.active_index.min(index),
                        ..current.clone()
                    }
                };
                leaf_node(next)
            });
            settle_focus(with_root(layout, root), pane_id)
        }
    }
}

/// Drop tabs whose document is no longer open (`open_keys`), keeping the preview,
/// then collapse whatever that empties. A layout outlives the documents in it.
#[must_use]
pub fn prune_layout(layout: &PaneLayout, open_keys: &HashSet<String>) -> PaneLayout {
    let only_pane = leaves(&layout.root).len() == 1;
    fn rewrite(node: &PaneNode, open: &HashSet<String>, only_pane: bool) -> Option<PaneNode> {
        match node {
            PaneNode::Leaf(leaf) => {
                let tabs: Vec<TabRef> = leaf
                    .tabs
                    .iter()
                    .filter(|t| is_preview_tab(t) || open.contains(&tab_key(t)))
                    .cloned()
                    .collect();
                if tabs.is_empty() && !only_pane {
                    return None;
                }
                Some(PaneNode::Leaf(clamp_index(PaneLeaf {
                    tabs,
                    ..leaf.clone()
                })))
            }
            PaneNode::Split(split) => {
                let first = rewrite(&split.children.0, open, only_pane);
                let second = rewrite(&split.children.1, open, only_pane);
                match (first, second) {
                    (None, survivor) | (survivor, None) => survivor,
                    (Some(first), Some(second)) => Some(PaneNode::Split(PaneSplit {
                        children: (Box::new(first), Box::new(second)),
                        ..split.clone()
                    })),
                }
            }
        }
    }
    let root = rewrite(&layout.root, open_keys, only_pane).unwrap_or_else(|| empty_layout(DEFAULT_PANE_ID).root);
    settle_focus(root, &layout.focused_pane_id)
}

/// Stamp an opening mode onto every tab that has never been switched. `modes`
/// holds the default for each tab key the caller wants stamped; a tab that already
/// carries a mode, or has no entry in `modes`, is left as it is.
#[must_use]
pub fn hydrate_tab_modes(layout: &PaneLayout, modes: &BTreeMap<String, DocumentMode>) -> PaneLayout {
    fn rewrite(node: &PaneNode, modes: &BTreeMap<String, DocumentMode>) -> PaneNode {
        match node {
            PaneNode::Leaf(leaf) => PaneNode::Leaf(PaneLeaf {
                tabs: leaf
                    .tabs
                    .iter()
                    .map(|tab| match (tab.mode, modes.get(&tab_key(tab))) {
                        (None, Some(mode)) => TabRef {
                            mode: Some(*mode),
                            ..tab.clone()
                        },
                        _ => tab.clone(),
                    })
                    .collect(),
                ..leaf.clone()
            }),
            PaneNode::Split(split) => PaneNode::Split(PaneSplit {
                children: (
                    Box::new(rewrite(&split.children.0, modes)),
                    Box::new(rewrite(&split.children.1, modes)),
                ),
                ..split.clone()
            }),
        }
    }
    PaneLayout {
        root: rewrite(&layout.root, modes),
        focused_pane_id: layout.focused_pane_id.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::{BTreeMap, HashSet};

    fn tab(kind: &str, id: &str) -> TabRef {
        TabRef {
            kind: kind.to_owned(),
            id: id.to_owned(),
            mode: None,
            group: None,
        }
    }
    fn a() -> TabRef {
        tab("vault_page", "a")
    }
    fn b() -> TabRef {
        tab("vault_page", "b")
    }
    fn c() -> TabRef {
        tab("paper", "c")
    }
    fn start() -> PaneLayout {
        empty_layout(DEFAULT_PANE_ID)
    }
    fn open(layout: &PaneLayout, t: &TabRef) -> PaneLayout {
        open_tab(layout, t, DEFAULT_PANE_ID)
    }
    fn open_ab() -> PaneLayout {
        open(&open(&start(), &a()), &b())
    }
    fn labels(layout: &PaneLayout) -> Vec<String> {
        leaves(&layout.root)
            .iter()
            .map(|leaf| leaf.tabs.iter().map(|t| t.id.clone()).collect::<Vec<_>>().join(","))
            .collect()
    }
    fn active_of(layout: &PaneLayout, pane: usize) -> Option<TabRef> {
        active_tab(leaves(&layout.root)[pane]).cloned()
    }
    fn split_of(layout: &PaneLayout) -> &PaneSplit {
        match &layout.root {
            PaneNode::Split(split) => split,
            PaneNode::Leaf(_) => panic!("root is a leaf"),
        }
    }
    fn keys(list: &[&str]) -> HashSet<String> {
        list.iter().map(|k| (*k).to_owned()).collect()
    }

    #[test]
    fn opening_a_document_twice_focuses_the_open_tab() {
        let mut layout = open_ab();
        assert_eq!(labels(&layout), vec!["a,b"]);
        layout = open(&layout, &a());
        assert_eq!(labels(&layout), vec!["a,b"]);
        assert_eq!(active_of(&layout, 0), Some(a()));
    }

    #[test]
    fn a_split_carries_the_active_tab_across() {
        let layout = split_pane(&open_ab(), DEFAULT_PANE_ID, SplitDirection::Row, "pane-2");
        assert_eq!(labels(&layout), vec!["a,b", "b"]);
        assert_eq!(layout.focused_pane_id, "pane-2");
        assert_eq!(split_of(&layout).direction, SplitDirection::Row);
    }

    #[test]
    fn splitting_an_empty_pane_leaves_two_empty_panes() {
        let layout = split_pane(&start(), DEFAULT_PANE_ID, SplitDirection::Column, "pane-2");
        assert_eq!(labels(&layout), vec!["", ""]);
    }

    #[test]
    fn splitting_a_missing_pane_changes_nothing() {
        let before = open(&start(), &a());
        assert_eq!(split_pane(&before, "pane-missing", SplitDirection::Row, "pane-9"), before);
    }

    #[test]
    fn closing_the_last_tab_of_a_split_collapses_it() {
        let layout = split_pane(&open(&start(), &a()), DEFAULT_PANE_ID, SplitDirection::Row, "pane-2");
        let closed = close_tab(&layout, "pane-2", 0);
        assert!(matches!(closed.root, PaneNode::Leaf(_)));
        assert_eq!(labels(&closed), vec!["a"]);
        assert_eq!(closed.focused_pane_id, "pane-1");
    }

    #[test]
    fn the_last_pane_survives_its_last_tab() {
        let closed = close_tab(&open(&start(), &a()), DEFAULT_PANE_ID, 0);
        assert!(matches!(closed.root, PaneNode::Leaf(_)));
        assert_eq!(labels(&closed), vec![""]);
        assert_eq!(active_of(&closed, 0), None);
    }

    #[test]
    fn closing_a_tab_left_of_the_active_one_keeps_the_same_document() {
        let layout = activate_tab(&open(&open(&open_ab(), &c()), &c()), DEFAULT_PANE_ID, 0);
        let closed = close_tab(&layout, DEFAULT_PANE_ID, 0);
        assert_eq!(active_of(&closed, 0), Some(b()));
    }

    #[test]
    fn closing_the_rightmost_active_tab_lands_on_the_new_rightmost() {
        let layout = activate_tab(&open_ab(), DEFAULT_PANE_ID, 1);
        let closed = close_tab(&layout, DEFAULT_PANE_ID, 1);
        assert_eq!(active_of(&closed, 0), Some(a()));
    }

    #[test]
    fn an_out_of_range_activation_is_clamped() {
        let layout = activate_tab(&open(&start(), &a()), DEFAULT_PANE_ID, 99);
        assert_eq!(leaves(&layout.root)[0].active_index, 0);
    }

    #[test]
    fn a_tab_moved_to_the_other_pane_leaves_the_first_and_focuses_the_second() {
        let split = split_pane(&open_ab(), DEFAULT_PANE_ID, SplitDirection::Row, "pane-2");
        let moved = move_tab(&split, DEFAULT_PANE_ID, 0, "pane-2", None);
        assert_eq!(labels(&moved), vec!["b", "b,a"]);
        assert_eq!(moved.focused_pane_id, "pane-2");
    }

    #[test]
    fn moving_a_tab_onto_its_own_pane_just_activates_it() {
        let moved = move_tab(&open_ab(), DEFAULT_PANE_ID, 0, DEFAULT_PANE_ID, None);
        assert_eq!(labels(&moved), vec!["a,b"]);
        assert_eq!(active_of(&moved, 0), Some(a()));
    }

    #[test]
    fn dropping_on_a_tab_in_its_own_strip_reorders_and_keeps_it_active() {
        let layout = open(&open_ab(), &c());
        let right = move_tab(&layout, DEFAULT_PANE_ID, 0, DEFAULT_PANE_ID, Some(2));
        assert_eq!(labels(&right), vec!["b,c,a"]);
        assert_eq!(active_of(&right, 0), Some(a()));

        let left = move_tab(&layout, DEFAULT_PANE_ID, 2, DEFAULT_PANE_ID, Some(0));
        assert_eq!(labels(&left), vec!["c,a,b"]);
        assert_eq!(active_of(&left, 0), Some(c()));
    }

    #[test]
    fn dropping_a_tab_on_a_tab_in_another_pane_inserts_it_there() {
        let split = split_pane(&open_ab(), DEFAULT_PANE_ID, SplitDirection::Row, "pane-2");
        let moved = move_tab(&split, DEFAULT_PANE_ID, 0, "pane-2", Some(0));
        assert_eq!(labels(&moved), vec!["b", "a,b"]);
        assert_eq!(active_of(&moved, 1), Some(a()));
        assert_eq!(moved.focused_pane_id, "pane-2");
    }

    #[test]
    fn dropping_on_a_pane_that_already_has_the_document_just_shows_it() {
        let split = split_pane(&open_ab(), DEFAULT_PANE_ID, SplitDirection::Row, "pane-2");
        let moved = move_tab(&split, DEFAULT_PANE_ID, 1, "pane-2", Some(0));
        assert_eq!(labels(&moved), vec!["a", "b"]);
    }

    #[test]
    fn an_index_past_the_end_lands_the_tab_last() {
        let layout = open_ab();
        assert_eq!(labels(&move_tab(&layout, DEFAULT_PANE_ID, 0, DEFAULT_PANE_ID, Some(9))), vec!["b,a"]);
    }

    #[test]
    fn moving_a_tab_that_is_not_there_changes_nothing() {
        let before = open(&start(), &a());
        assert_eq!(move_tab(&before, DEFAULT_PANE_ID, 7, DEFAULT_PANE_ID, None), before);
    }

    #[test]
    fn the_ratio_is_set_and_never_lets_a_side_vanish() {
        let layout = split_pane(&open(&start(), &a()), DEFAULT_PANE_ID, SplitDirection::Row, "pane-2");
        let target = split_of(&layout).clone();
        assert_eq!(split_of(&set_ratio(&layout, &target, 0.72)).ratio, 0.72);
        assert_eq!(split_of(&set_ratio(&layout, &target, 0.0)).ratio, 0.1);
        assert_eq!(split_of(&set_ratio(&layout, &target, 5.0)).ratio, 0.9);
    }

    #[test]
    fn focus_only_moves_to_a_pane_that_exists() {
        let layout = split_pane(&open(&start(), &a()), DEFAULT_PANE_ID, SplitDirection::Row, "pane-2");
        assert_eq!(focus_pane(&layout, "pane-1").focused_pane_id, "pane-1");
        assert_eq!(focus_pane(&layout, "pane-gone").focused_pane_id, "pane-2");
    }

    #[test]
    fn a_tab_whose_document_is_gone_is_pruned_not_rendered_broken() {
        let split = split_pane(&open_ab(), DEFAULT_PANE_ID, SplitDirection::Row, "pane-2");
        let pruned = prune_layout(&split, &keys(&["vault_page:a"]));
        assert!(matches!(pruned.root, PaneNode::Leaf(_)));
        assert_eq!(labels(&pruned), vec!["a"]);
    }

    #[test]
    fn pruning_everything_leaves_one_empty_pane() {
        let split = split_pane(&open(&start(), &a()), DEFAULT_PANE_ID, SplitDirection::Row, "pane-2");
        let pruned = prune_layout(&split, &keys(&[]));
        assert!(matches!(pruned.root, PaneNode::Leaf(_)));
        assert_eq!(labels(&pruned), vec![""]);
        assert_eq!(pruned.focused_pane_id, leaves(&pruned.root)[0].id);
    }

    #[test]
    fn pruning_clamps_an_active_index_that_pointed_past_the_survivors() {
        let layout = activate_tab(&open_ab(), DEFAULT_PANE_ID, 1);
        let pruned = prune_layout(&layout, &keys(&["vault_page:a"]));
        assert_eq!(active_of(&pruned, 0), Some(a()));
    }

    #[test]
    fn pruning_keeps_the_preview() {
        let layout = toggle_preview(&open(&start(), &a()), "pane-p");
        let pruned = prune_layout(&layout, &keys(&["vault_page:a"]));
        assert_eq!(labels(&pruned), vec!["a", "active"]);
    }

    #[test]
    fn the_active_key_is_the_focused_panes_active_tab() {
        let layout = activate_tab(&open_ab(), DEFAULT_PANE_ID, 1);
        assert_eq!(active_tab_key(&layout).as_deref(), Some("vault_page:b"));
        assert_eq!(active_tab_ref(&layout), Some(b()));
    }

    #[test]
    fn the_active_key_follows_the_focused_pane_across_a_split() {
        let layout = split_pane(&open_ab(), DEFAULT_PANE_ID, SplitDirection::Row, "pane-2");
        assert_eq!(layout.focused_pane_id, "pane-2");
        assert_eq!(active_tab_key(&layout).as_deref(), Some("vault_page:b"));

        let back = focus_pane(&layout, DEFAULT_PANE_ID);
        assert_eq!(active_tab_key(&back).as_deref(), Some("vault_page:b"));
        assert_eq!(active_tab_key(&activate_tab(&back, DEFAULT_PANE_ID, 0)).as_deref(), Some("vault_page:a"));
    }

    #[test]
    fn a_layout_with_nothing_open_has_no_active_key() {
        assert_eq!(active_tab_key(&start()), None);
        assert_eq!(active_tab_ref(&start()), None);
    }

    #[test]
    fn closing_the_only_tab_of_the_focused_pane_falls_back_to_the_pane_left() {
        let layout = split_pane(&open(&start(), &a()), DEFAULT_PANE_ID, SplitDirection::Row, "pane-2");
        let emptied = close_tab(&layout, "pane-2", 0);
        assert_eq!(active_tab_key(&emptied).as_deref(), Some("vault_page:a"));
    }

    #[test]
    fn a_tab_that_predates_modes_reads_as_edit_and_ink_pages_as_ink() {
        assert_eq!(tab_mode(&a()), DocumentMode::Edit);
        assert_eq!(tab_mode(&tab("ink_page", "i")), DocumentMode::Ink);
        assert_eq!(tab_mode(&tab("paper_pdf", "p")), DocumentMode::Ink);
    }

    #[test]
    fn hydrate_stamps_the_opening_mode_on_tabs_never_switched() {
        let layout = open_ab();
        let modes = BTreeMap::from([
            ("vault_page:a".to_owned(), DocumentMode::Read),
            ("vault_page:b".to_owned(), DocumentMode::Edit),
        ]);
        let next = hydrate_tab_modes(&layout, &modes);
        let first = leaves(&next.root)[0];
        assert_eq!(first.tabs[0].mode, Some(DocumentMode::Read));
        assert_eq!(first.tabs[1].mode, Some(DocumentMode::Edit));
    }

    #[test]
    fn hydrate_leaves_a_mode_the_user_chose_alone() {
        let chosen = set_tab_mode(&open(&start(), &a()), &a(), DocumentMode::Edit);
        let modes = BTreeMap::from([("vault_page:a".to_owned(), DocumentMode::Read)]);
        let next = hydrate_tab_modes(&chosen, &modes);
        assert_eq!(leaves(&next.root)[0].tabs[0].mode, Some(DocumentMode::Edit));
    }

    #[test]
    fn hydrate_returns_the_same_layout_when_there_is_nothing_to_stamp() {
        let layout = set_tab_mode(&open(&start(), &a()), &a(), DocumentMode::Read);
        let modes = BTreeMap::from([("vault_page:a".to_owned(), DocumentMode::Edit)]);
        assert_eq!(hydrate_tab_modes(&layout, &modes), layout);
    }

    #[test]
    fn set_mode_touches_only_the_addressed_tab() {
        let next = set_tab_mode(&open_ab(), &a(), DocumentMode::Read);
        let first = leaves(&next.root)[0];
        assert_eq!(tab_mode(&first.tabs[0]), DocumentMode::Read);
        assert_eq!(tab_mode(&first.tabs[1]), DocumentMode::Edit);
    }

    #[test]
    fn a_mode_belongs_to_the_document_so_it_applies_in_every_pane_showing_it() {
        let layout = split_pane(&open(&start(), &a()), DEFAULT_PANE_ID, SplitDirection::Row, "pane-2");
        let next = set_tab_mode(&layout, &a(), DocumentMode::Read);
        for leaf in leaves(&next.root) {
            assert_eq!(tab_mode(&leaf.tabs[0]), DocumentMode::Read);
        }
    }

    #[test]
    fn split_opens_the_preview_to_the_right_and_keeps_focus() {
        let layout = toggle_preview(&open(&start(), &a()), "pane-p");
        assert_eq!(labels(&layout), vec!["a", "active"]);
        assert_eq!(split_of(&layout).direction, SplitDirection::Row);
        assert_eq!(layout.focused_pane_id, "pane-1");
        assert!(preview_open(&layout));
        assert_eq!(leaves(&layout.root)[1].tabs[0].kind, PREVIEW_KIND);
    }

    #[test]
    fn pressing_split_again_closes_the_preview_wherever_it_went() {
        let open_preview = toggle_preview(&open(&start(), &a()), "pane-p");
        let closed = toggle_preview(&open_preview, "pane-x");
        assert_eq!(labels(&closed), vec!["a"]);
        assert!(!preview_open(&closed));

        let from_preview = toggle_preview(&focus_pane(&open_preview, "pane-p"), "pane-x");
        assert_eq!(labels(&from_preview), vec!["a"]);
        assert_eq!(from_preview.focused_pane_id, "pane-1");
    }

    #[test]
    fn the_preview_follows_the_focused_document_and_holds_while_the_preview_has_focus() {
        let mut layout = toggle_preview(&open_ab(), "pane-p");
        assert_eq!(preview_source(&layout, None), Some(b()));

        layout = activate_tab(&layout, DEFAULT_PANE_ID, 0);
        assert_eq!(preview_source(&layout, Some(&b())), Some(a()));
        // Clicking into the preview must not make it preview itself.
        assert_eq!(preview_source(&focus_pane(&layout, "pane-p"), Some(&a())), Some(a()));
        assert_eq!(preview_source(&focus_pane(&layout, "pane-p"), None), None);
        assert_eq!(PREVIEW_KIND, "preview");
    }

    #[test]
    fn setting_the_mode_a_document_is_already_in_returns_the_same_layout() {
        let layout = set_tab_mode(&open(&start(), &a()), &a(), DocumentMode::Read);
        assert_eq!(set_tab_mode(&layout, &a(), DocumentMode::Read), layout);
    }

    #[test]
    fn choosing_edit_on_a_default_tab_records_the_choice() {
        let layout = open(&start(), &a());
        let chosen = set_tab_mode(&layout, &a(), DocumentMode::Edit);
        assert_ne!(chosen, layout);
        assert_eq!(leaves(&chosen.root)[0].tabs[0].mode, Some(DocumentMode::Edit));
        assert_eq!(set_tab_mode(&chosen, &a(), DocumentMode::Edit), chosen);
    }

    #[test]
    fn setting_a_mode_on_a_tab_that_is_not_open_changes_nothing() {
        let layout = open(&start(), &a());
        assert_eq!(set_tab_mode(&layout, &b(), DocumentMode::Read), layout);
    }

    #[test]
    fn the_mode_survives_closing_and_reopening_the_same_document() {
        let opened = set_tab_mode(&open(&start(), &a()), &a(), DocumentMode::Read);
        let closed = close_tab(&opened, DEFAULT_PANE_ID, 0);
        let reopened = open_tab(&closed, &tab_at(&opened, DEFAULT_PANE_ID, 0).unwrap(), DEFAULT_PANE_ID);
        assert_eq!(tab_mode(&leaves(&reopened.root)[0].tabs[0]), DocumentMode::Read);
    }

    #[test]
    fn a_pane_chord_is_one_pure_step_from_the_layout_it_acts_on() {
        let two = open_ab();
        let pane = two.focused_pane_id.clone();
        assert_eq!(layout_for_command(&two, PaneCommand::NextTab, "pane-x"), activate_tab(&two, &pane, 0));
        let first = activate_tab(&two, &pane, 0);
        assert_eq!(layout_for_command(&first, PaneCommand::PreviousTab, "pane-x"), activate_tab(&two, &pane, 1));
        assert_eq!(labels(&layout_for_command(&two, PaneCommand::CloseTab, "pane-x")), vec!["a"]);
        assert!(preview_open(&layout_for_command(&two, PaneCommand::ToggleMode, "pane-p")));
        let toggled = layout_for_command(&two, PaneCommand::ToggleMode, "pane-p");
        assert!(!preview_open(&layout_for_command(&toggled, PaneCommand::ToggleMode, "pane-q")));
        assert_eq!(leaves(&layout_for_command(&two, PaneCommand::SplitRight, "pane-s").root).len(), 2);
    }

    #[test]
    fn a_tab_chord_on_an_empty_pane_changes_nothing() {
        let empty = start();
        for command in [PaneCommand::CloseTab, PaneCommand::NextTab, PaneCommand::PreviousTab, PaneCommand::ToggleMode] {
            assert_eq!(layout_for_command(&empty, command, "pane-x"), empty);
        }
    }

    #[test]
    fn a_tab_number_chord_activates_that_tab_and_one_past_the_end_does_nothing() {
        let three = activate_tab(&open(&open(&open_ab(), &c()), &c()).clone(), DEFAULT_PANE_ID, 1);
        let pane = three.focused_pane_id.clone();
        assert_eq!(layout_for_command(&three, PaneCommand::Tab1, "pane-x"), activate_tab(&three, &pane, 0));
        assert_eq!(layout_for_command(&three, PaneCommand::Tab3, "pane-x"), activate_tab(&three, &pane, 2));
        assert_eq!(layout_for_command(&three, PaneCommand::LastTab, "pane-x"), activate_tab(&three, &pane, 2));
        // Tab 5 with three tabs open is a miss, not "the last one".
        assert_eq!(layout_for_command(&three, PaneCommand::Tab5, "pane-x"), three);
        assert_eq!(layout_for_command(&start(), PaneCommand::LastTab, "pane-x"), start());
    }

    #[test]
    fn the_focused_panes_tab_count_is_what_a_tab_number_chord_can_reach() {
        let three = open(&open(&open_ab(), &c()), &c());
        assert_eq!(focused_tab_count(&three), 3);
        assert_eq!(focused_tab_count(&start()), 0);
    }

    #[test]
    fn closed_tabs_lists_tabs_gone_from_every_pane_in_shown_order() {
        let note_a = tab("note", "a");
        let note_b = tab("note", "b");
        let layout = open(&open(&start(), &note_a), &note_b);
        assert_eq!(closed_tabs(&layout, &close_tab(&layout, DEFAULT_PANE_ID, 0)), vec![note_a.clone()]);

        // A tab still open in another pane is not closed.
        let split = split_pane(&layout, DEFAULT_PANE_ID, SplitDirection::Row, "pane-2");
        let after = close_tab(&split, "pane-2", 0);
        assert_eq!(closed_tabs(&split, &after), Vec::<TabRef>::new());
        assert_eq!(closed_tabs(&after, &after), Vec::<TabRef>::new());
    }

    fn abcd() -> PaneLayout {
        ["a", "b", "c", "d"]
            .iter()
            .fold(start(), |layout, id| open(&layout, &tab("vault_page", id)))
    }
    fn ids(layout: &PaneLayout, pane: usize) -> Vec<String> {
        leaves(&layout.root)[pane].tabs.iter().map(|t| t.id.clone()).collect()
    }
    fn act(layout: &PaneLayout, index: i32, action: TabMenuAction, new_pane: &str) -> PaneLayout {
        layout_for_tab_menu(layout, DEFAULT_PANE_ID, index, &TabMenuCommand::Action(action), new_pane)
    }

    #[test]
    fn menu_close_drops_only_the_clicked_tab() {
        assert_eq!(ids(&act(&abcd(), 1, TabMenuAction::Close, "pane-2"), 0), vec!["a", "c", "d"]);
    }

    #[test]
    fn menu_close_others_keeps_the_clicked_tab_and_makes_it_active() {
        let after = act(&abcd(), 2, TabMenuAction::CloseOthers, "pane-2");
        assert_eq!(ids(&after, 0), vec!["c"]);
        assert_eq!(leaves(&after.root)[0].active_index, 0);
    }

    #[test]
    fn menu_close_right_keeps_the_clicked_tab_and_those_before_it() {
        let after = act(&abcd(), 1, TabMenuAction::CloseRight, "pane-2");
        assert_eq!(ids(&after, 0), vec!["a", "b"]);
        // d was active and is gone, so the clicked tab takes over.
        assert_eq!(leaves(&after.root)[0].active_index, 1);
    }

    #[test]
    fn menu_close_right_on_the_last_tab_changes_nothing() {
        let base = abcd();
        assert_eq!(act(&base, 3, TabMenuAction::CloseRight, "pane-2"), base);
    }

    #[test]
    fn menu_split_right_carries_the_clicked_tab_into_a_new_pane_beside() {
        let after = act(&abcd(), 0, TabMenuAction::SplitRight, "pane-2");
        assert_eq!(split_of(&after).direction, SplitDirection::Row);
        assert_eq!(ids(&after, 1), vec!["a"]);
        assert_eq!(after.focused_pane_id, leaves(&after.root)[1].id);
    }

    #[test]
    fn menu_split_down_stacks_the_new_pane_below() {
        let after = act(&abcd(), 2, TabMenuAction::SplitDown, "pane-2");
        assert_eq!(split_of(&after).direction, SplitDirection::Column);
        assert_eq!(ids(&after, 1), vec!["c"]);
    }

    #[test]
    fn menu_on_a_pane_that_does_not_exist_is_left_alone() {
        let base = abcd();
        assert_eq!(layout_for_tab_menu(&base, "pane-missing", 0, &TabMenuCommand::Action(TabMenuAction::CloseOthers), "pane-2"), base);
    }

    #[test]
    fn menu_group_command_is_applied_to_the_clicked_tab() {
        let grouped = layout_for_tab_menu(
            &abcd(),
            DEFAULT_PANE_ID,
            0,
            &TabMenuCommand::Group(TabGroupCommand::New),
            "pane-2",
        );
        assert_eq!(leaves(&grouped.root)[0].tabs[0].group.as_deref(), Some("g1"));
    }
}
