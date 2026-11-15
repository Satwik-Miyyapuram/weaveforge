//! Graph persisted-state merge and vault page create/tree for JavaScript. The JS names match
//! `packages/core/src/features/relations/domain/parts.ts` and
//! `packages/core/src/shared/core-contract.ts` (vault page types).

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::relations::graph_settings::{self, GraphPersistedState};
use wf_core::vault::page::{self, TreePage, VaultPageSummary, VaultPageTreeNode};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`merge_graph_persisted_state`](graph_settings::merge_graph_persisted_state): `stored` is the
/// parsed state, or `null` for the defaults.
///
/// # Errors
///
/// Fails if `stored` has the wrong shape.
#[wasm_bindgen(js_name = mergeGraphPersistedState, unchecked_return_type = "B.GraphPersistedState")]
pub fn merge_graph_persisted_state_js(
    #[wasm_bindgen(unchecked_param_type = "B.GraphPersistedState | null")] stored: JsValue,
) -> JsResult<JsValue> {
    let stored: Option<GraphPersistedState> = serde_wasm_bindgen::from_value(stored)?;
    to_js(&graph_settings::merge_graph_persisted_state(stored))
}

/// One caller page: the summary fields the tree is built from, and the caller's own object.
#[derive(Clone)]
struct JsTreePage {
    summary: VaultPageSummary,
    value: JsValue,
}

impl TreePage for JsTreePage {
    fn id(&self) -> &str {
        self.summary.id()
    }
    fn title(&self) -> &str {
        self.summary.title()
    }
    fn parent_id(&self) -> Option<&str> {
        self.summary.parent_id()
    }
    fn sort_order(&self) -> f64 {
        self.summary.sort_order()
    }
}

/// `nodes` as JS `{ page, children }` objects holding the caller's own page objects.
fn tree_to_js(nodes: &[VaultPageTreeNode<JsTreePage>]) -> js_sys::Array {
    nodes
        .iter()
        .map(|node| {
            let out = js_sys::Object::new();
            // Setting a field on a fresh plain object cannot fail.
            let _ = js_sys::Reflect::set(&out, &JsValue::from_str("page"), &node.page.value);
            let _ = js_sys::Reflect::set(
                &out,
                &JsValue::from_str("children"),
                &tree_to_js(&node.children),
            );
            JsValue::from(out)
        })
        .collect()
}

/// [`build_page_tree`](page::build_page_tree): pages nested by `parentId`, each level sorted.
/// The nodes hold the caller's own page objects.
///
/// # Errors
///
/// Fails if `pages` has the wrong shape.
#[wasm_bindgen(js_name = buildPageTree, unchecked_return_type = "unknown")]
pub fn build_page_tree_js(
    #[wasm_bindgen(unchecked_param_type = "readonly B.VaultPageSummary[]")] pages: JsValue,
) -> JsResult<js_sys::Array> {
    let summaries: Vec<VaultPageSummary> = serde_wasm_bindgen::from_value(pages.clone())?;
    let values = js_sys::Array::from(&pages);
    let pages: Vec<JsTreePage> = summaries
        .into_iter()
        .zip(values.iter())
        .map(|(summary, value)| JsTreePage { summary, value })
        .collect();
    Ok(tree_to_js(&page::build_page_tree(&pages)))
}
