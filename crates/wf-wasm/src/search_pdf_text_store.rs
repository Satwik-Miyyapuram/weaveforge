//! PDF text store keys, key ranges and budget for JavaScript (wf-core `search::pdf_text_store`).

use serde::{Deserialize, Serialize};
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::search::js_text::utf16_len;
use wf_core::search::pdf_text_store;

use super::to_js;

/// One operation of [`pdf_text_store_op`].
#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "camelCase")]
enum Op {
    /// The IndexedDB key of a paper's text.
    #[serde(rename_all = "camelCase")]
    Key {
        project_id: Option<String>,
        paper_id: String,
    },
    /// The inclusive key bounds of a project.
    #[serde(rename_all = "camelCase")]
    Range { project_id: Option<String> },
    /// How many leading pages fit the storage budget.
    Budget { pages: Vec<PageText> },
}

#[derive(Deserialize)]
struct PageText {
    text: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct KeyRange {
    lower: String,
    upper: String,
}

/// The PDF text store's pure rules, one dispatcher keyed by `op`:
///
/// - `{ op: "key", projectId, paperId }`: the key, a string.
/// - `{ op: "range", projectId }`: `{ lower, upper }`, the inclusive key bounds of the project.
/// - `{ op: "budget", pages: { text }[] }`: the number of leading pages to keep.
///
/// # Errors
///
/// Fails if `input` does not match one of the operations above.
#[wasm_bindgen(
    js_name = pdfTextStoreOp,
    unchecked_return_type = "string | { readonly lower: string; readonly upper: string } | number"
)]
pub fn pdf_text_store_op(
    #[wasm_bindgen(
        unchecked_param_type = "{ readonly op: \"key\"; readonly projectId: string | null; readonly paperId: string } | { readonly op: \"range\"; readonly projectId: string | null } | { readonly op: \"budget\"; readonly pages: readonly { readonly text: string }[] }"
    )]
    input: JsValue,
) -> Result<JsValue, JsValue> {
    let op: Op = serde_wasm_bindgen::from_value(input)?;
    let out = match op {
        Op::Key {
            project_id,
            paper_id,
        } => to_js(&pdf_text_store::store_key(project_id.as_deref(), &paper_id))?,
        Op::Range { project_id } => {
            let (lower, upper) = pdf_text_store::project_range(project_id.as_deref());
            to_js(&KeyRange { lower, upper })?
        }
        Op::Budget { pages } => {
            let lengths: Vec<usize> = pages.iter().map(|page| utf16_len(&page.text)).collect();
            to_js(&pdf_text_store::budget_page_count(&lengths))?
        }
    };
    Ok(out)
}
