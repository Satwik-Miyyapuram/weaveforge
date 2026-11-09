//! Editor workspace for JavaScript: the explorer tree (`workspace_tree`), the
//! pane layout (`pane_tree`) and tab groups (`tab_groups`) in wf-core.

use std::collections::{BTreeMap, HashMap, HashSet};

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::editor_workspace::pane_tree::{
    self as pane, DocumentMode, PaneCommand, PaneLayout, PaneLeaf, PaneNode, PaneSplit,
    SplitDirection, TabMenuCommand, TabRef,
};
use wf_core::editor_workspace::tab_groups::{self as groups, TabGroupCommand, TabRun};
use wf_core::editor_workspace::workspace_tree::{
    self as tree, ListItemEntry, ListsTreeInput, VisibleRow, WorkspaceTreeInput,
    WorkspaceTreeNode,
};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`build_workspace_tree`](tree::build_workspace_tree).
///
/// # Errors
///
/// Fails if `input` has the wrong shape.
#[wasm_bindgen(js_name = buildWorkspaceTree)]
pub fn build_workspace_tree_js(input: JsValue) -> JsResult<JsValue> {
    let input: WorkspaceTreeInput = serde_wasm_bindgen::from_value(input)?;
    to_js(&tree::build_workspace_tree(&input))
}

/// [`flatten_tree`](tree::flatten_tree).
///
/// # Errors
///
/// Fails if `nodes` has the wrong shape.
#[wasm_bindgen(js_name = flattenTree)]
pub fn flatten_tree_js(nodes: JsValue) -> JsResult<JsValue> {
    let nodes: Vec<WorkspaceTreeNode> = serde_wasm_bindgen::from_value(nodes)?;
    to_js(&tree::flatten_tree(&nodes))
}

/// [`is_document_node`](tree::is_document_node).
///
/// # Errors
///
/// Fails if `node` has the wrong shape.
#[wasm_bindgen(js_name = isDocumentNode)]
pub fn is_document_node_js(node: JsValue) -> JsResult<bool> {
    let node: DocumentProbe = serde_wasm_bindgen::from_value(node)?;
    Ok(tree::is_document_kind(node.kind, node.folder))
}

/// The fields of a tree row that [`is_document_node_js`] reads.
#[derive(serde::Deserialize)]
struct DocumentProbe {
    kind: tree::TreeNodeKind,
    #[serde(default)]
    folder: bool,
}

/// [`folder_ids_of`](tree::folder_ids_of). Returns an array; the TS wrapper makes the `Set`.
///
/// # Errors
///
/// Fails if `nodes` has the wrong shape.
#[wasm_bindgen(js_name = folderIdsOf)]
pub fn folder_ids_of_js(nodes: JsValue) -> JsResult<JsValue> {
    let nodes: Vec<WorkspaceTreeNode> = serde_wasm_bindgen::from_value(nodes)?;
    let mut ids: Vec<String> = tree::folder_ids_of(&nodes).into_iter().collect();
    ids.sort();
    to_js(&ids)
}

/// [`visible_rows`](tree::visible_rows). `expanded` is an array of keys.
///
/// # Errors
///
/// Fails if either argument has the wrong shape.
#[wasm_bindgen(js_name = visibleRows)]
pub fn visible_rows_js(nodes: JsValue, expanded: JsValue) -> JsResult<JsValue> {
    let nodes: Vec<WorkspaceTreeNode> = serde_wasm_bindgen::from_value(nodes)?;
    let expanded: Vec<String> = serde_wasm_bindgen::from_value(expanded)?;
    let expanded = expanded.into_iter().collect();
    to_js(&tree::visible_rows(&nodes, &expanded))
}

/// [`slug_segment`](tree::slug_segment).
#[wasm_bindgen(js_name = slugSegment)]
pub fn slug_segment_js(title: &str) -> String {
    tree::slug_segment(title)
}

/// [`build_lists_tree`](tree::build_lists_tree). `input` is a `ListsTreeInput`.
///
/// # Errors
///
/// Fails if `input` has the wrong shape.
#[wasm_bindgen(js_name = buildListsTree)]
pub fn build_lists_tree_js(input: JsValue) -> JsResult<JsValue> {
    let input: ListsTreeInput = serde_wasm_bindgen::from_value(input)?;
    to_js(&tree::build_lists_tree(&input))
}

/// [`list_membership`](tree::list_membership). Returns a JS `Map` of `kind:id` to list titles.
///
/// # Errors
///
/// Fails if either argument has the wrong shape.
#[wasm_bindgen(js_name = listMembership)]
pub fn list_membership_js(items: JsValue, titles: JsValue) -> JsResult<JsValue> {
    let items: Vec<ListItemEntry> = serde_wasm_bindgen::from_value(items)?;
    let titles: HashMap<String, String> = serde_wasm_bindgen::from_value(titles)?;
    let membership: BTreeMap<String, Vec<String>> = tree::list_membership(&items, &titles);
    to_js(&membership)
}

/// [`filter_rows`](tree::filter_rows). `rows` is an array of `VisibleRow`.
///
/// # Errors
///
/// Fails if `rows` has the wrong shape.
#[wasm_bindgen(js_name = filterRows)]
pub fn filter_rows_js(rows: JsValue, query: &str) -> JsResult<JsValue> {
    let rows: Vec<VisibleRow> = serde_wasm_bindgen::from_value(rows)?;
    to_js(&tree::filter_rows(&rows, query))
}

/// [`preview_tab`](pane::preview_tab).
///
/// # Errors
///
/// Never fails in practice; returns the serializer's result type.
#[wasm_bindgen(js_name = previewTab)]
pub fn preview_tab_js() -> JsResult<JsValue> {
    to_js(&pane::preview_tab())
}

/// [`tab_key`](pane::tab_key).
///
/// # Errors
///
/// Fails if `tab` has the wrong shape.
#[wasm_bindgen(js_name = tabKey)]
pub fn tab_key_js(tab: JsValue) -> JsResult<String> {
    let tab: TabRef = serde_wasm_bindgen::from_value(tab)?;
    Ok(pane::tab_key(&tab))
}

/// [`empty_layout`](pane::empty_layout).
///
/// # Errors
///
/// Never fails in practice; returns the serializer's result type.
#[wasm_bindgen(js_name = emptyLayout)]
pub fn empty_layout_js(pane_id: &str) -> JsResult<JsValue> {
    to_js(&pane::empty_layout(pane_id))
}

/// [`leaves`](pane::leaves). Returns owned copies of the leaves.
///
/// # Errors
///
/// Fails if `node` has the wrong shape.
#[wasm_bindgen(js_name = leaves)]
pub fn leaves_js(node: JsValue) -> JsResult<JsValue> {
    let node: PaneNode = serde_wasm_bindgen::from_value(node)?;
    let owned: Vec<PaneLeaf> = pane::leaves(&node).into_iter().cloned().collect();
    to_js(&owned)
}

/// [`open_tab`](pane::open_tab).
///
/// # Errors
///
/// Fails if `layout` or `tab` has the wrong shape.
#[wasm_bindgen(js_name = openTab)]
pub fn open_tab_js(layout: JsValue, tab: JsValue, pane_id: &str) -> JsResult<JsValue> {
    let layout: PaneLayout = serde_wasm_bindgen::from_value(layout)?;
    let tab: TabRef = serde_wasm_bindgen::from_value(tab)?;
    to_js(&pane::open_tab(&layout, &tab, pane_id))
}

/// [`activate_tab`](pane::activate_tab).
///
/// # Errors
///
/// Fails if `layout` has the wrong shape.
#[wasm_bindgen(js_name = activateTab)]
pub fn activate_tab_js(layout: JsValue, pane_id: &str, index: i32) -> JsResult<JsValue> {
    let layout: PaneLayout = serde_wasm_bindgen::from_value(layout)?;
    to_js(&pane::activate_tab(&layout, pane_id, index))
}

/// [`close_tab`](pane::close_tab).
///
/// # Errors
///
/// Fails if `layout` has the wrong shape.
#[wasm_bindgen(js_name = closeTab)]
pub fn close_tab_js(layout: JsValue, pane_id: &str, index: i32) -> JsResult<JsValue> {
    let layout: PaneLayout = serde_wasm_bindgen::from_value(layout)?;
    to_js(&pane::close_tab(&layout, pane_id, index))
}

/// [`split_pane`](pane::split_pane). `direction` is `"row"` or `"column"`.
///
/// # Errors
///
/// Fails if `layout` or `direction` has the wrong shape.
#[wasm_bindgen(js_name = splitPane)]
pub fn split_pane_js(
    layout: JsValue,
    pane_id: &str,
    direction: JsValue,
    new_pane_id: &str,
) -> JsResult<JsValue> {
    let layout: PaneLayout = serde_wasm_bindgen::from_value(layout)?;
    let direction: SplitDirection = serde_wasm_bindgen::from_value(direction)?;
    to_js(&pane::split_pane(&layout, pane_id, direction, new_pane_id))
}

/// [`move_tab`](pane::move_tab).
///
/// # Errors
///
/// Fails if `layout` has the wrong shape.
#[wasm_bindgen(js_name = moveTab)]
pub fn move_tab_js(
    layout: JsValue,
    from_pane_id: &str,
    from_index: i32,
    to_pane_id: &str,
    to_index: Option<i32>,
) -> JsResult<JsValue> {
    let layout: PaneLayout = serde_wasm_bindgen::from_value(layout)?;
    to_js(&pane::move_tab(
        &layout,
        from_pane_id,
        from_index,
        to_pane_id,
        to_index,
    ))
}

/// [`set_ratio`](pane::set_ratio). `target` is the split being resized.
///
/// # Errors
///
/// Fails if `layout` or `target` has the wrong shape.
#[wasm_bindgen(js_name = setRatio)]
pub fn set_ratio_js(layout: JsValue, target: JsValue, ratio: f64) -> JsResult<JsValue> {
    let layout: PaneLayout = serde_wasm_bindgen::from_value(layout)?;
    let target: PaneSplit = serde_wasm_bindgen::from_value(target)?;
    to_js(&pane::set_ratio(&layout, &target, ratio))
}

/// [`focus_pane`](pane::focus_pane).
///
/// # Errors
///
/// Fails if `layout` has the wrong shape.
#[wasm_bindgen(js_name = focusPane)]
pub fn focus_pane_js(layout: JsValue, pane_id: &str) -> JsResult<JsValue> {
    let layout: PaneLayout = serde_wasm_bindgen::from_value(layout)?;
    to_js(&pane::focus_pane(&layout, pane_id))
}

/// [`active_tab`](pane::active_tab). Takes a leaf.
///
/// # Errors
///
/// Fails if `leaf` has the wrong shape.
#[wasm_bindgen(js_name = activeTab)]
pub fn active_tab_js(leaf: JsValue) -> JsResult<JsValue> {
    let leaf: PaneLeaf = serde_wasm_bindgen::from_value(leaf)?;
    to_js(&pane::active_tab(&leaf).cloned())
}

/// [`active_tab_ref`](pane::active_tab_ref).
///
/// # Errors
///
/// Fails if `layout` has the wrong shape.
#[wasm_bindgen(js_name = activeTabRef)]
pub fn active_tab_ref_js(layout: JsValue) -> JsResult<JsValue> {
    let layout: PaneLayout = serde_wasm_bindgen::from_value(layout)?;
    to_js(&pane::active_tab_ref(&layout))
}

/// [`active_tab_key`](pane::active_tab_key).
///
/// # Errors
///
/// Fails if `layout` has the wrong shape.
#[wasm_bindgen(js_name = activeTabKey)]
pub fn active_tab_key_js(layout: JsValue) -> JsResult<JsValue> {
    let layout: PaneLayout = serde_wasm_bindgen::from_value(layout)?;
    to_js(&pane::active_tab_key(&layout))
}

/// [`tab_mode`](pane::tab_mode). Returns `"edit"`, `"read"` or `"ink"`.
///
/// # Errors
///
/// Fails if `tab` has the wrong shape.
#[wasm_bindgen(js_name = tabMode)]
pub fn tab_mode_js(tab: JsValue) -> JsResult<JsValue> {
    let tab: TabRef = serde_wasm_bindgen::from_value(tab)?;
    to_js(&pane::tab_mode(&tab))
}

/// [`tab_at`](pane::tab_at).
///
/// # Errors
///
/// Fails if `layout` has the wrong shape.
#[wasm_bindgen(js_name = tabAt)]
pub fn tab_at_js(layout: JsValue, pane_id: &str, index: i32) -> JsResult<JsValue> {
    let layout: PaneLayout = serde_wasm_bindgen::from_value(layout)?;
    to_js(&pane::tab_at(&layout, pane_id, index))
}

/// [`set_tab_mode`](pane::set_tab_mode). `mode` is `"edit"`, `"read"` or `"ink"`.
///
/// # Errors
///
/// Fails if an argument has the wrong shape.
#[wasm_bindgen(js_name = setTabMode)]
pub fn set_tab_mode_js(layout: JsValue, target: JsValue, mode: JsValue) -> JsResult<JsValue> {
    let layout: PaneLayout = serde_wasm_bindgen::from_value(layout)?;
    let target: TabRef = serde_wasm_bindgen::from_value(target)?;
    let mode: DocumentMode = serde_wasm_bindgen::from_value(mode)?;
    to_js(&pane::set_tab_mode(&layout, &target, mode))
}

/// [`preview_open`](pane::preview_open).
///
/// # Errors
///
/// Fails if `layout` has the wrong shape.
#[wasm_bindgen(js_name = previewOpen)]
pub fn preview_open_js(layout: JsValue) -> JsResult<bool> {
    let layout: PaneLayout = serde_wasm_bindgen::from_value(layout)?;
    Ok(pane::preview_open(&layout))
}

/// [`toggle_preview`](pane::toggle_preview).
///
/// # Errors
///
/// Fails if `layout` has the wrong shape.
#[wasm_bindgen(js_name = togglePreview)]
pub fn toggle_preview_js(layout: JsValue, new_pane_id: &str) -> JsResult<JsValue> {
    let layout: PaneLayout = serde_wasm_bindgen::from_value(layout)?;
    to_js(&pane::toggle_preview(&layout, new_pane_id))
}

/// [`preview_source`](pane::preview_source). `previous` may be `undefined`.
///
/// # Errors
///
/// Fails if an argument has the wrong shape.
#[wasm_bindgen(js_name = previewSource)]
pub fn preview_source_js(layout: JsValue, previous: JsValue) -> JsResult<JsValue> {
    let layout: PaneLayout = serde_wasm_bindgen::from_value(layout)?;
    let previous: Option<TabRef> = serde_wasm_bindgen::from_value(previous)?;
    to_js(&pane::preview_source(&layout, previous.as_ref()))
}

/// [`open_tab_keys`](pane::open_tab_keys).
///
/// # Errors
///
/// Fails if `layout` has the wrong shape.
#[wasm_bindgen(js_name = openTabKeys)]
pub fn open_tab_keys_js(layout: JsValue) -> JsResult<JsValue> {
    let layout: PaneLayout = serde_wasm_bindgen::from_value(layout)?;
    to_js(&pane::open_tab_keys(&layout))
}

/// [`closed_tabs`](pane::closed_tabs).
///
/// # Errors
///
/// Fails if a layout has the wrong shape.
#[wasm_bindgen(js_name = closedTabs)]
pub fn closed_tabs_js(before: JsValue, after: JsValue) -> JsResult<JsValue> {
    let before: PaneLayout = serde_wasm_bindgen::from_value(before)?;
    let after: PaneLayout = serde_wasm_bindgen::from_value(after)?;
    to_js(&pane::closed_tabs(&before, &after))
}

/// [`focused_tab_count`](pane::focused_tab_count).
///
/// # Errors
///
/// Fails if `layout` has the wrong shape.
#[wasm_bindgen(js_name = focusedTabCount)]
pub fn focused_tab_count_js(layout: JsValue) -> JsResult<i32> {
    let layout: PaneLayout = serde_wasm_bindgen::from_value(layout)?;
    Ok(pane::focused_tab_count(&layout))
}

/// [`layout_for_command`](pane::layout_for_command). `command` is a chord name such as `"split-right"`.
///
/// # Errors
///
/// Fails if an argument has the wrong shape.
#[wasm_bindgen(js_name = layoutForCommand)]
pub fn layout_for_command_js(
    layout: JsValue,
    command: JsValue,
    new_pane_id: &str,
) -> JsResult<JsValue> {
    let layout: PaneLayout = serde_wasm_bindgen::from_value(layout)?;
    let command: PaneCommand = serde_wasm_bindgen::from_value(command)?;
    to_js(&pane::layout_for_command(&layout, command, new_pane_id))
}

/// [`layout_for_tab_menu`](pane::layout_for_tab_menu).
///
/// # Errors
///
/// Fails if an argument has the wrong shape.
#[wasm_bindgen(js_name = layoutForTabMenu)]
pub fn layout_for_tab_menu_js(
    layout: JsValue,
    pane_id: &str,
    index: i32,
    command: JsValue,
    new_pane_id: &str,
) -> JsResult<JsValue> {
    let layout: PaneLayout = serde_wasm_bindgen::from_value(layout)?;
    let command: TabMenuCommand = serde_wasm_bindgen::from_value(command)?;
    to_js(&pane::layout_for_tab_menu(
        &layout,
        pane_id,
        index,
        &command,
        new_pane_id,
    ))
}

/// [`prune_layout`](pane::prune_layout). `open_keys` is an array of tab keys.
///
/// # Errors
///
/// Fails if an argument has the wrong shape.
#[wasm_bindgen(js_name = pruneLayout)]
pub fn prune_layout_js(layout: JsValue, open_keys: JsValue) -> JsResult<JsValue> {
    let layout: PaneLayout = serde_wasm_bindgen::from_value(layout)?;
    let open_keys: Vec<String> = serde_wasm_bindgen::from_value(open_keys)?;
    let open_keys: HashSet<String> = open_keys.into_iter().collect();
    to_js(&pane::prune_layout(&layout, &open_keys))
}

/// [`hydrate_tab_modes`](pane::hydrate_tab_modes). `modes` is an object of tab key to mode.
///
/// # Errors
///
/// Fails if an argument has the wrong shape.
#[wasm_bindgen(js_name = hydrateTabModes)]
pub fn hydrate_tab_modes_js(layout: JsValue, modes: JsValue) -> JsResult<JsValue> {
    let layout: PaneLayout = serde_wasm_bindgen::from_value(layout)?;
    let modes: BTreeMap<String, DocumentMode> = serde_wasm_bindgen::from_value(modes)?;
    to_js(&pane::hydrate_tab_modes(&layout, &modes))
}

/// [`without_group`](groups::without_group).
///
/// # Errors
///
/// Fails if `tab` has the wrong shape.
#[wasm_bindgen(js_name = withoutGroup)]
pub fn without_group_js(tab: JsValue) -> JsResult<JsValue> {
    let tab: TabRef = serde_wasm_bindgen::from_value(tab)?;
    to_js(&groups::without_group(&tab))
}

/// [`clean_groups`](groups::clean_groups).
///
/// # Errors
///
/// Fails if `leaf` has the wrong shape.
#[wasm_bindgen(js_name = cleanGroups)]
pub fn clean_groups_js(leaf: JsValue) -> JsResult<JsValue> {
    let leaf: PaneLeaf = serde_wasm_bindgen::from_value(leaf)?;
    to_js(&groups::clean_groups(&leaf))
}

/// [`apply_group_command`](groups::apply_group_command).
///
/// # Errors
///
/// Fails if an argument has the wrong shape.
#[wasm_bindgen(js_name = applyGroupCommand)]
pub fn apply_group_command_js(leaf: JsValue, index: i32, command: JsValue) -> JsResult<JsValue> {
    let leaf: PaneLeaf = serde_wasm_bindgen::from_value(leaf)?;
    let command: TabGroupCommand = serde_wasm_bindgen::from_value(command)?;
    to_js(&groups::apply_group_command(&leaf, index, &command))
}

/// [`group_runs`](groups::group_runs).
///
/// # Errors
///
/// Fails if `leaf` has the wrong shape.
#[wasm_bindgen(js_name = groupRuns)]
pub fn group_runs_js(leaf: JsValue) -> JsResult<JsValue> {
    let leaf: PaneLeaf = serde_wasm_bindgen::from_value(leaf)?;
    let runs: Vec<TabRun> = groups::group_runs(&leaf);
    to_js(&runs)
}
