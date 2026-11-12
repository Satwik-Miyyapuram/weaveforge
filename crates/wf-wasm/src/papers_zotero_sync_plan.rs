//! The plan for one Zotero sync (wf-core `papers::zotero_sync_plan`).

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::papers::zotero_mapping::ZoteroItem;
use wf_core::papers::zotero_sync_plan::{self, ZoteroSyncLocal};

use super::to_js;

/// [`sync_plan`](zotero_sync_plan::sync_plan) (TS `ZoteroSync`): which remote items to pull, and
/// which local papers to push or delete, from one snapshot.
///
/// # Errors
///
/// Fails if `remote` or `local` is not a list of the expected shape, or the plan cannot be converted.
#[wasm_bindgen(js_name = zoteroSyncPlan, unchecked_return_type = "B.ZoteroSyncPlan")]
pub fn zotero_sync_plan_js(
    #[wasm_bindgen(unchecked_param_type = "readonly B.ZoteroItem[]")] remote: JsValue,
    #[wasm_bindgen(unchecked_param_type = "readonly B.ZoteroSyncLocal[]")] local: JsValue,
) -> Result<JsValue, JsValue> {
    let remote: Vec<ZoteroItem> = serde_wasm_bindgen::from_value(remote)?;
    let local: Vec<ZoteroSyncLocal> = serde_wasm_bindgen::from_value(local)?;
    Ok(to_js(&zotero_sync_plan::sync_plan(&remote, &local))?)
}
