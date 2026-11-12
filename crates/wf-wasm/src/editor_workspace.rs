//! Editor workspace for JavaScript: the explorer tree (`workspace_tree`), the
//! pane layout (`pane_tree`) and tab groups (`tab_groups`) in wf-core.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::atomic::{AtomicU32, Ordering};

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::editor_workspace::keybindings::{self as keys, KeyChord};
use wf_core::editor_workspace::layout_record;
use wf_core::editor_workspace::pane_tree::{
    self as pane, DocumentMode, PaneCommand, PaneLayout, PaneLeaf, PaneNode, PaneSplit,
    SplitDirection, TabMenuCommand, TabRef,
};
use wf_core::editor_workspace::tab_groups::{self as groups, TabGroupCommand, TabRun};
use wf_core::editor_workspace::workspace_tree::{
    self as tree, ListItemEntry, ListsTreeInput, VisibleRow, WorkspaceTreeInput, WorkspaceTreeNode,
};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`build_workspace_tree`](tree::build_workspace_tree).
///
/// # Errors
///
/// Fails if `input` has the wrong shape.
#[wasm_bindgen(js_name = buildWorkspaceTree, unchecked_return_type = "B.WorkspaceTreeNode[]")]
pub fn build_workspace_tree_js(
    #[wasm_bindgen(unchecked_param_type = "B.WorkspaceTreeInput")] input: JsValue,
) -> JsResult<JsValue> {
    let input: WorkspaceTreeInput = serde_wasm_bindgen::from_value(input)?;
    to_js(&tree::build_workspace_tree(&input))
}

/// [`flatten_tree`](tree::flatten_tree).
///
/// # Errors
///
/// Fails if `nodes` has the wrong shape.
#[wasm_bindgen(js_name = flattenTree, unchecked_return_type = "B.WorkspaceTreeNode[]")]
pub fn flatten_tree_js(
    #[wasm_bindgen(unchecked_param_type = "readonly B.WorkspaceTreeNode[]")] nodes: JsValue,
) -> JsResult<JsValue> {
    let nodes: Vec<WorkspaceTreeNode> = serde_wasm_bindgen::from_value(nodes)?;
    to_js(&tree::flatten_tree(&nodes))
}

/// [`is_document_node`](tree::is_document_node).
///
/// # Errors
///
/// Fails if `node` has the wrong shape.
#[wasm_bindgen(js_name = isDocumentNode)]
pub fn is_document_node_js(
    #[wasm_bindgen(unchecked_param_type = "Pick<B.WorkspaceTreeNode, \"kind\" | \"folder\">")] node: JsValue,
) -> JsResult<bool> {
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

/// [`folder_ids_of`](tree::folder_ids_of) as a JS `Set`, filled in sorted order.
///
/// # Errors
///
/// Fails if `nodes` has the wrong shape.
#[wasm_bindgen(js_name = folderIdsOf, unchecked_return_type = "Set<string>")]
pub fn folder_ids_of_js(
    #[wasm_bindgen(unchecked_param_type = "readonly B.WorkspaceTreeNode[]")] nodes: JsValue,
) -> Result<JsValue, JsValue> {
    let nodes: Vec<WorkspaceTreeNode> = serde_wasm_bindgen::from_value(nodes)?;
    let mut ids: Vec<String> = tree::folder_ids_of(&nodes).into_iter().collect();
    ids.sort();
    let set = js_sys::Set::new(&JsValue::UNDEFINED);
    for id in &ids {
        let _ = set.add(&JsValue::from_str(id));
    }
    Ok(set.into())
}

/// [`visible_rows`](tree::visible_rows). `expanded` is the set of expanded keys.
///
/// # Errors
///
/// Fails if either argument has the wrong shape.
#[wasm_bindgen(js_name = visibleRows, unchecked_return_type = "B.VisibleRow[]")]
pub fn visible_rows_js(
    #[wasm_bindgen(unchecked_param_type = "readonly B.WorkspaceTreeNode[]")] nodes: JsValue,
    #[wasm_bindgen(unchecked_param_type = "ReadonlySet<string>")] expanded: &JsValue,
) -> Result<JsValue, JsValue> {
    let nodes: Vec<WorkspaceTreeNode> = serde_wasm_bindgen::from_value(nodes)?;
    let expanded: Vec<String> =
        serde_wasm_bindgen::from_value(js_sys::Array::from(expanded).into())?;
    let expanded = expanded.into_iter().collect();
    Ok(to_js(&tree::visible_rows(&nodes, &expanded))?)
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
#[wasm_bindgen(js_name = buildListsTree, unchecked_return_type = "B.WorkspaceTreeNode[]")]
pub fn build_lists_tree_js(
    #[wasm_bindgen(unchecked_param_type = "B.ListsTreeInput")] input: JsValue,
) -> JsResult<JsValue> {
    let input: ListsTreeInput = serde_wasm_bindgen::from_value(input)?;
    to_js(&tree::build_lists_tree(&input))
}

/// [`list_membership`](tree::list_membership). `titles` maps list id to title; returns a JS
/// `Map` of `kind:id` to list titles, in key order.
///
/// # Errors
///
/// Fails if either argument has the wrong shape.
#[wasm_bindgen(js_name = listMembership, unchecked_return_type = "Map<string, string[]>")]
pub fn list_membership_js(
    #[wasm_bindgen(unchecked_param_type = "readonly B.ListItemEntry[]")] items: JsValue,
    #[wasm_bindgen(unchecked_param_type = "ReadonlyMap<string, string>")] titles: &JsValue,
) -> Result<JsValue, JsValue> {
    let items: Vec<ListItemEntry> = serde_wasm_bindgen::from_value(items)?;
    let titles: HashMap<String, String> = crate::search_document::map_arg(titles)?;
    let membership: BTreeMap<String, Vec<String>> = tree::list_membership(&items, &titles);
    let map = js_sys::Map::new();
    for (key, lists) in &membership {
        let _ = map.set(&JsValue::from_str(key), &to_js(lists)?);
    }
    Ok(map.into())
}

/// [`filter_rows`](tree::filter_rows): the rows to paint and the keys to expand (a JS `Set`).
///
/// # Errors
///
/// Fails if `rows` has the wrong shape.
#[wasm_bindgen(
    js_name = filterRows,
    unchecked_return_type = "{ rows: B.VisibleRow[]; expand: Set<string> }"
)]
pub fn filter_rows_js(
    #[wasm_bindgen(unchecked_param_type = "readonly B.VisibleRow[]")] rows: JsValue,
    query: &str,
) -> Result<JsValue, JsValue> {
    let rows: Vec<VisibleRow> = serde_wasm_bindgen::from_value(rows)?;
    let filtered = tree::filter_rows(&rows, query);
    let expand = js_sys::Set::new(&JsValue::UNDEFINED);
    for key in &filtered.expand {
        let _ = expand.add(&JsValue::from_str(key));
    }
    let out = js_sys::Object::new();
    let _ = js_sys::Reflect::set(&out, &JsValue::from_str("rows"), &to_js(&filtered.rows)?)?;
    let _ = js_sys::Reflect::set(&out, &JsValue::from_str("expand"), &expand)?;
    Ok(out.into())
}

/// [`preview_tab`](pane::preview_tab).
///
/// # Errors
///
/// Never fails in practice; returns the serializer's result type.
#[wasm_bindgen(js_name = previewTab, unchecked_return_type = "B.TabRef")]
pub fn preview_tab_js() -> JsResult<JsValue> {
    to_js(&pane::preview_tab())
}

/// [`tab_key`](pane::tab_key).
///
/// # Errors
///
/// Fails if `tab` has the wrong shape.
#[wasm_bindgen(js_name = tabKey)]
pub fn tab_key_js(
    #[wasm_bindgen(unchecked_param_type = "B.TabRef")] tab: JsValue,
) -> JsResult<String> {
    let tab: TabRef = serde_wasm_bindgen::from_value(tab)?;
    Ok(pane::tab_key(&tab))
}

/// [`empty_layout`](pane::empty_layout).
///
/// # Errors
///
/// Never fails in practice; returns the serializer's result type.
#[wasm_bindgen(js_name = emptyLayout, unchecked_return_type = "B.PaneLayout")]
pub fn empty_layout_js(pane_id: Option<String>) -> JsResult<JsValue> {
    to_js(&pane::empty_layout(pane_id.as_deref().unwrap_or("pane-1")))
}

/// [`layout_from_record`](layout_record::layout_from_record). A missing or
/// unusable record is one empty pane, so this never fails on content.
///
/// # Errors
///
/// Never fails in practice; returns the serializer's result type.
#[wasm_bindgen(js_name = layoutFromRecord, unchecked_return_type = "B.PaneLayout")]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn layout_from_record_js(raw: Option<String>) -> JsResult<JsValue> {
    to_js(&layout_record::layout_from_record(raw.as_deref()))
}

/// [`leaves`](pane::leaves). Returns owned copies of the leaves.
///
/// # Errors
///
/// Fails if `node` has the wrong shape.
#[wasm_bindgen(js_name = leaves, unchecked_return_type = "B.PaneLeaf[]")]
pub fn leaves_js(
    #[wasm_bindgen(unchecked_param_type = "B.PaneNode")] node: JsValue,
) -> JsResult<JsValue> {
    let node: PaneNode = serde_wasm_bindgen::from_value(node)?;
    let owned: Vec<PaneLeaf> = pane::leaves(&node).into_iter().cloned().collect();
    to_js(&owned)
}

/// [`open_tab`](pane::open_tab). `pane_id` defaults to the focused pane.
///
/// # Errors
///
/// Fails if `layout` or `tab` has the wrong shape.
#[wasm_bindgen(js_name = openTab, unchecked_return_type = "B.PaneLayout")]
pub fn open_tab_js(
    #[wasm_bindgen(unchecked_param_type = "B.PaneLayout")] layout: JsValue,
    #[wasm_bindgen(unchecked_param_type = "B.TabRef")] tab: JsValue,
    pane_id: Option<String>,
) -> JsResult<JsValue> {
    let layout: PaneLayout = serde_wasm_bindgen::from_value(layout)?;
    let tab: TabRef = serde_wasm_bindgen::from_value(tab)?;
    let pane_id = pane_id.unwrap_or_else(|| layout.focused_pane_id.clone());
    to_js(&pane::open_tab(&layout, &tab, &pane_id))
}

/// [`activate_tab`](pane::activate_tab).
///
/// # Errors
///
/// Fails if `layout` has the wrong shape.
#[wasm_bindgen(js_name = activateTab, unchecked_return_type = "B.PaneLayout")]
pub fn activate_tab_js(
    #[wasm_bindgen(unchecked_param_type = "B.PaneLayout")] layout: JsValue,
    pane_id: &str,
    index: i32,
) -> JsResult<JsValue> {
    let layout: PaneLayout = serde_wasm_bindgen::from_value(layout)?;
    to_js(&pane::activate_tab(&layout, pane_id, index))
}

/// [`close_tab`](pane::close_tab).
///
/// # Errors
///
/// Fails if `layout` has the wrong shape.
#[wasm_bindgen(js_name = closeTab, unchecked_return_type = "B.PaneLayout")]
pub fn close_tab_js(
    #[wasm_bindgen(unchecked_param_type = "B.PaneLayout")] layout: JsValue,
    pane_id: &str,
    index: i32,
) -> JsResult<JsValue> {
    let layout: PaneLayout = serde_wasm_bindgen::from_value(layout)?;
    to_js(&pane::close_tab(&layout, pane_id, index))
}

/// [`split_pane`](pane::split_pane). `direction` is `"row"` or `"column"`; `new_pane_id`
/// defaults to a fresh [`next_pane_id`].
///
/// # Errors
///
/// Fails if `layout` or `direction` has the wrong shape.
#[wasm_bindgen(js_name = splitPane, unchecked_return_type = "B.PaneLayout")]
pub fn split_pane_js(
    #[wasm_bindgen(unchecked_param_type = "B.PaneLayout")] layout: JsValue,
    pane_id: &str,
    #[wasm_bindgen(unchecked_param_type = "B.SplitDirection")] direction: JsValue,
    new_pane_id: Option<String>,
) -> JsResult<JsValue> {
    let layout: PaneLayout = serde_wasm_bindgen::from_value(layout)?;
    let direction: SplitDirection = serde_wasm_bindgen::from_value(direction)?;
    let new_pane_id = new_pane_id.unwrap_or_else(next_pane_id);
    to_js(&pane::split_pane(&layout, pane_id, direction, &new_pane_id))
}

/// [`move_tab`](pane::move_tab). `to_index` is the slot on a tab drop, or omitted to append on
/// a pane drop.
///
/// # Errors
///
/// Fails if `layout` or `from` has the wrong shape.
#[wasm_bindgen(js_name = moveTab, unchecked_return_type = "B.PaneLayout")]
pub fn move_tab_js(
    #[wasm_bindgen(unchecked_param_type = "B.PaneLayout")] layout: JsValue,
    #[wasm_bindgen(unchecked_param_type = "{ paneId: string; index: number }")] from: JsValue,
    to_pane_id: &str,
    to_index: Option<i32>,
) -> JsResult<JsValue> {
    let layout: PaneLayout = serde_wasm_bindgen::from_value(layout)?;
    let from: TabSlot = serde_wasm_bindgen::from_value(from)?;
    to_js(&pane::move_tab(
        &layout,
        &from.pane_id,
        from.index,
        to_pane_id,
        to_index,
    ))
}

/// Where a dragged tab came from: its pane and its index there.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct TabSlot {
    pane_id: String,
    index: i32,
}

/// [`set_ratio`](pane::set_ratio). `target` is the split being resized.
///
/// # Errors
///
/// Fails if `layout` or `target` has the wrong shape.
#[wasm_bindgen(js_name = setRatio, unchecked_return_type = "B.PaneLayout")]
pub fn set_ratio_js(
    #[wasm_bindgen(unchecked_param_type = "B.PaneLayout")] layout: JsValue,
    #[wasm_bindgen(unchecked_param_type = "B.PaneSplit")] target: JsValue,
    ratio: f64,
) -> JsResult<JsValue> {
    let layout: PaneLayout = serde_wasm_bindgen::from_value(layout)?;
    let target: PaneSplit = serde_wasm_bindgen::from_value(target)?;
    to_js(&pane::set_ratio(&layout, &target, ratio))
}

/// [`focus_pane`](pane::focus_pane).
///
/// # Errors
///
/// Fails if `layout` has the wrong shape.
#[wasm_bindgen(js_name = focusPane, unchecked_return_type = "B.PaneLayout")]
pub fn focus_pane_js(
    #[wasm_bindgen(unchecked_param_type = "B.PaneLayout")] layout: JsValue,
    pane_id: &str,
) -> JsResult<JsValue> {
    let layout: PaneLayout = serde_wasm_bindgen::from_value(layout)?;
    to_js(&pane::focus_pane(&layout, pane_id))
}

/// [`active_tab`](pane::active_tab). Takes a leaf; `undefined` when it has no active tab.
///
/// # Errors
///
/// Fails if `leaf` has the wrong shape.
#[wasm_bindgen(js_name = activeTab, unchecked_return_type = "B.TabRef | undefined")]
pub fn active_tab_js(
    #[wasm_bindgen(unchecked_param_type = "B.PaneLeaf")] leaf: JsValue,
) -> JsResult<JsValue> {
    let leaf: PaneLeaf = serde_wasm_bindgen::from_value(leaf)?;
    tab_or_undefined(pane::active_tab(&leaf))
}

/// [`active_tab_ref`](pane::active_tab_ref); `undefined` when there is none.
///
/// # Errors
///
/// Fails if `layout` has the wrong shape.
#[wasm_bindgen(js_name = activeTabRef, unchecked_return_type = "B.TabRef | undefined")]
pub fn active_tab_ref_js(
    #[wasm_bindgen(unchecked_param_type = "B.PaneLayout")] layout: JsValue,
) -> JsResult<JsValue> {
    let layout: PaneLayout = serde_wasm_bindgen::from_value(layout)?;
    tab_or_undefined(pane::active_tab_ref(&layout).as_ref())
}

/// [`active_tab_key`](pane::active_tab_key); `undefined` when there is none.
///
/// # Errors
///
/// Fails if `layout` has the wrong shape.
#[wasm_bindgen(js_name = activeTabKey)]
pub fn active_tab_key_js(
    #[wasm_bindgen(unchecked_param_type = "B.PaneLayout")] layout: JsValue,
) -> JsResult<Option<String>> {
    let layout: PaneLayout = serde_wasm_bindgen::from_value(layout)?;
    Ok(pane::active_tab_key(&layout))
}

/// [`tab_mode`](pane::tab_mode). Returns `"edit"`, `"read"` or `"ink"`.
///
/// # Errors
///
/// Fails if `tab` has the wrong shape.
#[wasm_bindgen(js_name = tabMode, unchecked_return_type = "B.DocumentMode")]
pub fn tab_mode_js(
    #[wasm_bindgen(unchecked_param_type = "B.TabRef")] tab: JsValue,
) -> JsResult<JsValue> {
    let tab: TabRef = serde_wasm_bindgen::from_value(tab)?;
    to_js(&pane::tab_mode(&tab))
}

/// [`tab_at`](pane::tab_at); `undefined` when there is no tab there.
///
/// # Errors
///
/// Fails if `layout` has the wrong shape.
#[wasm_bindgen(js_name = tabAt, unchecked_return_type = "B.TabRef | undefined")]
pub fn tab_at_js(
    #[wasm_bindgen(unchecked_param_type = "B.PaneLayout")] layout: JsValue,
    pane_id: &str,
    index: i32,
) -> JsResult<JsValue> {
    let layout: PaneLayout = serde_wasm_bindgen::from_value(layout)?;
    tab_or_undefined(pane::tab_at(&layout, pane_id, index).as_ref())
}

/// [`set_tab_mode`](pane::set_tab_mode). `mode` is `"edit"`, `"read"` or `"ink"`.
///
/// # Errors
///
/// Fails if an argument has the wrong shape.
#[wasm_bindgen(js_name = setTabMode, unchecked_return_type = "B.PaneLayout")]
pub fn set_tab_mode_js(
    #[wasm_bindgen(unchecked_param_type = "B.PaneLayout")] layout: JsValue,
    #[wasm_bindgen(unchecked_param_type = "B.TabRef")] target: JsValue,
    #[wasm_bindgen(unchecked_param_type = "B.DocumentMode")] mode: JsValue,
) -> JsResult<JsValue> {
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
pub fn preview_open_js(
    #[wasm_bindgen(unchecked_param_type = "B.PaneLayout")] layout: JsValue,
) -> JsResult<bool> {
    let layout: PaneLayout = serde_wasm_bindgen::from_value(layout)?;
    Ok(pane::preview_open(&layout))
}

/// [`toggle_preview`](pane::toggle_preview). `new_pane_id` defaults to a fresh
/// [`next_pane_id`].
///
/// # Errors
///
/// Fails if `layout` has the wrong shape.
#[wasm_bindgen(js_name = togglePreview, unchecked_return_type = "B.PaneLayout")]
pub fn toggle_preview_js(
    #[wasm_bindgen(unchecked_param_type = "B.PaneLayout")] layout: JsValue,
    new_pane_id: Option<String>,
) -> JsResult<JsValue> {
    let layout: PaneLayout = serde_wasm_bindgen::from_value(layout)?;
    let new_pane_id = new_pane_id.unwrap_or_else(next_pane_id);
    to_js(&pane::toggle_preview(&layout, &new_pane_id))
}

/// [`preview_source`](pane::preview_source): the document the preview shows, the focused tab or
/// `previous` when the focus is on the preview itself. `undefined` when there is none.
///
/// # Errors
///
/// Fails if an argument has the wrong shape.
#[wasm_bindgen(js_name = previewSource, unchecked_return_type = "B.TabRef | undefined")]
pub fn preview_source_js(
    #[wasm_bindgen(unchecked_param_type = "B.PaneLayout")] layout: JsValue,
    #[wasm_bindgen(unchecked_param_type = "B.TabRef | undefined")] previous: JsValue,
) -> JsResult<JsValue> {
    let layout: PaneLayout = serde_wasm_bindgen::from_value(layout)?;
    let previous: Option<TabRef> = serde_wasm_bindgen::from_value(previous)?;
    tab_or_undefined(pane::preview_source(&layout, previous.as_ref()).as_ref())
}

/// [`open_tab_keys`](pane::open_tab_keys): the key of every tab open in any pane, as a `Set`.
///
/// # Errors
///
/// Fails if `layout` has the wrong shape.
#[wasm_bindgen(js_name = openTabKeys, unchecked_return_type = "Set<string>")]
pub fn open_tab_keys_js(
    #[wasm_bindgen(unchecked_param_type = "B.PaneLayout")] layout: JsValue,
) -> JsResult<JsValue> {
    let layout: PaneLayout = serde_wasm_bindgen::from_value(layout)?;
    let keys = js_sys::Set::new(&JsValue::UNDEFINED);
    for key in pane::open_tab_keys(&layout) {
        let _ = keys.add(&JsValue::from_str(&key));
    }
    Ok(keys.into())
}

/// [`closed_tabs`](pane::closed_tabs).
///
/// # Errors
///
/// Fails if a layout has the wrong shape.
#[wasm_bindgen(js_name = closedTabs, unchecked_return_type = "B.TabRef[]")]
pub fn closed_tabs_js(
    #[wasm_bindgen(unchecked_param_type = "B.PaneLayout")] before: JsValue,
    #[wasm_bindgen(unchecked_param_type = "B.PaneLayout")] after: JsValue,
) -> JsResult<JsValue> {
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
pub fn focused_tab_count_js(
    #[wasm_bindgen(unchecked_param_type = "B.PaneLayout")] layout: JsValue,
) -> JsResult<i32> {
    let layout: PaneLayout = serde_wasm_bindgen::from_value(layout)?;
    Ok(pane::focused_tab_count(&layout))
}

/// [`command_for_chord`](keys::command_for_chord): the workspace command a chord means, or
/// `null`.
///
/// The fields are read one by one, since a DOM `KeyboardEvent` keeps its modifiers on prototype
/// getters. `tab_count` defaults to unbounded; a non-finite count is unbounded too.
///
/// # Errors
///
/// Fails if `chord` is not an object or `chord.key` is not a string.
#[wasm_bindgen(js_name = commandForChord, unchecked_return_type = "string | null")]
pub fn command_for_chord_js(
    #[wasm_bindgen(unchecked_param_type = "B.KeyChord")] chord: &JsValue,
    tab_count: Option<f64>,
) -> Result<JsValue, JsValue> {
    let field = |name: &str| js_sys::Reflect::get(chord, &JsValue::from_str(name));
    let flag = |name: &str| field(name).map(|value| value.as_bool().unwrap_or(false));
    let key = field("key")?
        .as_string()
        .ok_or_else(|| JsValue::from(js_sys::Error::new("missing field `key`")))?;
    let chord = KeyChord {
        key,
        code: field("code")?.as_string(),
        ctrl_key: flag("ctrlKey")?,
        meta_key: flag("metaKey")?,
        shift_key: flag("shiftKey")?,
        alt_key: flag("altKey")?,
    };
    // A tab count is a small whole number; Infinity (the default) means unbounded.
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    let tab_count = tab_count
        .filter(|count| count.is_finite())
        .map(|count| count as usize);
    Ok(keys::command_for_chord(&chord, tab_count).map_or(JsValue::NULL, JsValue::from_str))
}

/// [`layout_for_command`](pane::layout_for_command). `command` is a chord name such as
/// `"split-right"`; `new_pane_id` defaults to a fresh [`next_pane_id`]. Returns `layout` itself
/// when the command changes nothing, so `next === layout` means "no change".
///
/// # Errors
///
/// Fails if an argument has the wrong shape.
#[wasm_bindgen(js_name = layoutForCommand, unchecked_return_type = "B.PaneLayout")]
pub fn layout_for_command_js(
    #[wasm_bindgen(unchecked_param_type = "B.PaneLayout")] layout: JsValue,
    #[wasm_bindgen(unchecked_param_type = "B.PaneCommand")] command: JsValue,
    new_pane_id: Option<String>,
) -> JsResult<JsValue> {
    let before: PaneLayout = serde_wasm_bindgen::from_value(layout.clone())?;
    let command: PaneCommand = serde_wasm_bindgen::from_value(command)?;
    let new_pane_id = new_pane_id.unwrap_or_else(next_pane_id);
    let after = pane::layout_for_command(&before, command, &new_pane_id);
    same_or(layout, &before, &after)
}

/// [`layout_for_tab_menu`](pane::layout_for_tab_menu). `new_pane_id` defaults to a fresh
/// [`next_pane_id`]. Returns `layout` itself when the command changes nothing.
///
/// # Errors
///
/// Fails if an argument has the wrong shape.
#[wasm_bindgen(js_name = layoutForTabMenu, unchecked_return_type = "B.PaneLayout")]
pub fn layout_for_tab_menu_js(
    #[wasm_bindgen(unchecked_param_type = "B.PaneLayout")] layout: JsValue,
    pane_id: &str,
    index: i32,
    #[wasm_bindgen(unchecked_param_type = "B.TabMenuCommand")] command: JsValue,
    new_pane_id: Option<String>,
) -> JsResult<JsValue> {
    let before: PaneLayout = serde_wasm_bindgen::from_value(layout.clone())?;
    let command: TabMenuCommand = serde_wasm_bindgen::from_value(command)?;
    let new_pane_id = new_pane_id.unwrap_or_else(next_pane_id);
    let after = pane::layout_for_tab_menu(&before, pane_id, index, &command, &new_pane_id);
    same_or(layout, &before, &after)
}

/// [`prune_layout`](pane::prune_layout): drop the tabs for which `exists` is false, then
/// collapse whatever that empties. Preview tabs are always kept.
///
/// # Errors
///
/// Fails if `layout` has the wrong shape, or rethrows what `exists` throws.
#[wasm_bindgen(js_name = pruneLayout, unchecked_return_type = "B.PaneLayout")]
pub fn prune_layout_js(
    #[wasm_bindgen(unchecked_param_type = "B.PaneLayout")] layout: JsValue,
    #[wasm_bindgen(unchecked_param_type = "(tab: B.TabRef) => boolean")] exists: &js_sys::Function,
) -> Result<JsValue, JsValue> {
    let layout: PaneLayout = serde_wasm_bindgen::from_value(layout)?;
    let mut open_keys = HashSet::new();
    for leaf in pane::leaves(&layout.root) {
        for tab in &leaf.tabs {
            if exists.call1(&JsValue::NULL, &to_js(tab)?)?.is_truthy() {
                let _ = open_keys.insert(pane::tab_key(tab));
            }
        }
    }
    to_js(&pane::prune_layout(&layout, &open_keys)).map_err(JsValue::from)
}

/// [`hydrate_tab_modes`](pane::hydrate_tab_modes): stamp `mode_for(tab)` onto every tab that
/// has no mode yet. A tab that already carries a mode is left alone. Returns `layout` itself
/// when no tab lacks a mode.
///
/// # Errors
///
/// Fails if `layout` or a returned mode has the wrong shape, or rethrows what `mode_for` throws.
#[wasm_bindgen(js_name = hydrateTabModes, unchecked_return_type = "B.PaneLayout")]
pub fn hydrate_tab_modes_js(
    #[wasm_bindgen(unchecked_param_type = "B.PaneLayout")] layout: JsValue,
    #[wasm_bindgen(unchecked_param_type = "(tab: B.TabRef) => B.DocumentMode")]
    mode_for: &js_sys::Function,
) -> Result<JsValue, JsValue> {
    let parsed: PaneLayout = serde_wasm_bindgen::from_value(layout.clone())?;
    let mut modes: BTreeMap<String, DocumentMode> = BTreeMap::new();
    for leaf in pane::leaves(&parsed.root) {
        for tab in leaf.tabs.iter().filter(|tab| tab.mode.is_none()) {
            let mode = mode_for.call1(&JsValue::NULL, &to_js(tab)?)?;
            let _ = modes.insert(pane::tab_key(tab), serde_wasm_bindgen::from_value(mode)?);
        }
    }
    if modes.is_empty() {
        return Ok(layout);
    }
    to_js(&pane::hydrate_tab_modes(&parsed, &modes)).map_err(JsValue::from)
}

/// True for the preview tab, which is one tab not tied to a document.
#[wasm_bindgen(js_name = isPreviewTab)]
#[must_use]
pub fn is_preview_tab_js(
    #[wasm_bindgen(unchecked_param_type = "B.TabRef | undefined")] tab: &JsValue,
) -> bool {
    if tab.is_undefined() || tab.is_null() {
        return false;
    }
    js_sys::Reflect::get(tab, &JsValue::from_str("kind"))
        .ok()
        .and_then(|kind| kind.as_string())
        .is_some_and(|kind| kind == pane::PREVIEW_KIND)
}

/// `tab` as a JS value, or `undefined` when there is none.
fn tab_or_undefined(tab: Option<&TabRef>) -> JsResult<JsValue> {
    tab.map_or(Ok(JsValue::UNDEFINED), to_js)
}

/// `layout` itself when `after` equals `before` (its parsed form), so `next === layout` means
/// "no change"; otherwise `after`.
fn same_or(layout: JsValue, before: &PaneLayout, after: &PaneLayout) -> JsResult<JsValue> {
    if before == after {
        Ok(layout)
    } else {
        to_js(after)
    }
}

/// Panes created this session, for [`next_pane_id`].
static PANE_COUNTER: AtomicU32 = AtomicU32::new(0);

/// A pane id unique within this session: `pane-<now in base 36>-<counter>`.
fn next_pane_id() -> String {
    let count = PANE_COUNTER.fetch_add(1, Ordering::Relaxed) + 1;
    // `Date.now()` is a whole, positive millisecond count well inside u64.
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    let now = js_sys::Date::now() as u64;
    format!("pane-{}-{count}", base36(now))
}

/// `n` in lowercase base 36, as JS `n.toString(36)` writes it.
fn base36(mut n: u64) -> String {
    let mut digits = Vec::new();
    loop {
        let digit = u32::try_from(n % 36).unwrap_or(0);
        digits.push(char::from_digit(digit, 36).unwrap_or('0'));
        n /= 36;
        if n == 0 {
            break;
        }
    }
    digits.iter().rev().collect()
}

/// [`without_group`](groups::without_group).
///
/// # Errors
///
/// Fails if `tab` has the wrong shape.
#[wasm_bindgen(js_name = withoutGroup, unchecked_return_type = "B.TabRef")]
pub fn without_group_js(
    #[wasm_bindgen(unchecked_param_type = "B.TabRef")] tab: JsValue,
) -> JsResult<JsValue> {
    let tab: TabRef = serde_wasm_bindgen::from_value(tab)?;
    to_js(&groups::without_group(&tab))
}

/// [`clean_groups`](groups::clean_groups).
///
/// # Errors
///
/// Fails if `leaf` has the wrong shape.
#[wasm_bindgen(js_name = cleanGroups, unchecked_return_type = "B.PaneLeaf")]
pub fn clean_groups_js(
    #[wasm_bindgen(unchecked_param_type = "B.PaneLeaf")] leaf: JsValue,
) -> JsResult<JsValue> {
    let leaf: PaneLeaf = serde_wasm_bindgen::from_value(leaf)?;
    to_js(&groups::clean_groups(&leaf))
}

/// [`apply_group_command`](groups::apply_group_command).
///
/// # Errors
///
/// Fails if an argument has the wrong shape.
#[wasm_bindgen(js_name = applyGroupCommand, unchecked_return_type = "B.PaneLeaf")]
pub fn apply_group_command_js(
    #[wasm_bindgen(unchecked_param_type = "B.PaneLeaf")] leaf: JsValue,
    index: i32,
    #[wasm_bindgen(unchecked_param_type = "B.TabGroupCommand")] command: JsValue,
) -> JsResult<JsValue> {
    let leaf: PaneLeaf = serde_wasm_bindgen::from_value(leaf)?;
    let command: TabGroupCommand = serde_wasm_bindgen::from_value(command)?;
    to_js(&groups::apply_group_command(&leaf, index, &command))
}

/// [`group_runs`](groups::group_runs).
///
/// # Errors
///
/// Fails if `leaf` has the wrong shape.
#[wasm_bindgen(js_name = groupRuns, unchecked_return_type = "B.TabRun[]")]
pub fn group_runs_js(
    #[wasm_bindgen(unchecked_param_type = "B.PaneLeaf")] leaf: JsValue,
) -> JsResult<JsValue> {
    let leaf: PaneLeaf = serde_wasm_bindgen::from_value(leaf)?;
    let runs: Vec<TabRun> = groups::group_runs(&leaf);
    to_js(&runs)
}
