//! Graph persisted-state merge and vault page create/tree for JavaScript. The JS names match
//! `packages/core/src/features/relations/domain/parts.ts` and
//! `packages/core/src/shared/core-contract.ts` (vault page types).

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::relations::graph_settings::{self, GraphPersistedState};
use wf_core::vault::page::{
    self, NewVaultPageInput, TreePage, VaultPageSummary, VaultPageTreeNode,
};

use super::experiment_member::{dep_text, named_error};
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

/// [`create_vault_page`](page::create_vault_page) with the id and time supplied.
///
/// # Errors
///
/// Fails if `input` has the wrong shape, or with the validation message when the title is blank.
#[wasm_bindgen(js_name = createVaultPageWith, unchecked_return_type = "B.VaultPage")]
pub fn create_vault_page_with_js(
    #[wasm_bindgen(unchecked_param_type = "unknown")] input: JsValue,
    id: &str,
    now: &str,
) -> JsResult<JsValue> {
    let input: NewVaultPageInput = serde_wasm_bindgen::from_value(input)?;
    let made = page::create_vault_page(&input, id, now).map_err(serde_wasm_bindgen::Error::new)?;
    to_js(&made)
}

/// A new vault page, its time from `deps.clock.nowIso()` and then its id from
/// `deps.ids.newId()`.
///
/// # Errors
///
/// Throws a `VaultPageValidationError` for a blank title or a wrongly shaped `input`, and
/// rethrows whatever `deps` throws.
#[wasm_bindgen(js_name = createVaultPage, unchecked_return_type = "B.VaultPage")]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn create_vault_page_js(
    #[wasm_bindgen(unchecked_param_type = "unknown")] input: JsValue,
    #[wasm_bindgen(
        unchecked_param_type = "{ clock: { nowIso(): string }; ids: { newId(): string } }"
    )]
    deps: JsValue,
) -> Result<JsValue, JsValue> {
    let now = dep_text(&deps, "clock", "nowIso")?;
    let id = dep_text(&deps, "ids", "newId")?;
    create_vault_page_with_js(input, &id, &now)
        .map_err(|error| named_error(error, "VaultPageValidationError"))
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
