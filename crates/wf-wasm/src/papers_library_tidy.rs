//! Library tidy-up for JavaScript (wf-core `papers::library_tidy`). The TS wrappers in
//! `packages/wf-wasm/src/papers-library-tidy.ts` re-export the generated types.

use wasm_bindgen::prelude::wasm_bindgen;
use wasm_bindgen::{JsError, JsValue};
use wf_core::papers::library_tidy::{
    TidyPaper, find_duplicate_groups, is_conference_copy, pick_keeper, title_fixes,
};

use super::to_js;

/// [`title_fixes`] (TS `titleFixes`). Only papers whose title needs a fix are listed.
///
/// # Errors
///
/// Fails if `papers` is not a list of paper summaries, or the result cannot be converted.
#[wasm_bindgen(js_name = titleFixes)]
pub fn title_fixes_js(papers: JsValue) -> Result<JsValue, JsError> {
    let papers: Vec<TidyPaper> =
        serde_wasm_bindgen::from_value(papers).map_err(|error| JsError::new(&error.to_string()))?;
    to_js(&title_fixes(&papers)).map_err(|error| JsError::new(&error.to_string()))
}

/// [`find_duplicate_groups`] (TS `findDuplicateGroups`). Groups of two or more papers.
///
/// # Errors
///
/// Fails if `papers` is not a list of paper summaries, or the result cannot be converted.
#[wasm_bindgen(js_name = findDuplicateGroups)]
pub fn find_duplicate_groups_js(papers: JsValue) -> Result<JsValue, JsError> {
    let papers: Vec<TidyPaper> =
        serde_wasm_bindgen::from_value(papers).map_err(|error| JsError::new(&error.to_string()))?;
    to_js(&find_duplicate_groups(&papers)).map_err(|error| JsError::new(&error.to_string()))
}

/// [`pick_keeper`] (TS `pickKeeper`), returning the kept paper's id.
///
/// # Errors
///
/// Fails if `group` is not a list of paper summaries, or it is empty.
#[wasm_bindgen(js_name = pickKeeper)]
pub fn pick_keeper_js(group: JsValue) -> Result<String, JsError> {
    let group: Vec<TidyPaper> =
        serde_wasm_bindgen::from_value(group).map_err(|error| JsError::new(&error.to_string()))?;
    let refs: Vec<&TidyPaper> = group.iter().collect();
    pick_keeper(&refs)
        .map(|paper| paper.id.clone())
        .ok_or_else(|| JsError::new("pickKeeper needs at least one paper"))
}

/// [`is_conference_copy`] (TS `isConferenceCopy`).
///
/// # Errors
///
/// Fails if `paper` is not a paper summary.
#[wasm_bindgen(js_name = isConferenceCopy)]
pub fn is_conference_copy_js(
    #[wasm_bindgen(unchecked_param_type = "B.TidyPaper")] paper: JsValue,
) -> Result<bool, JsError> {
    let paper: TidyPaper =
        serde_wasm_bindgen::from_value(paper).map_err(|error| JsError::new(&error.to_string()))?;
    Ok(is_conference_copy(&paper))
}
