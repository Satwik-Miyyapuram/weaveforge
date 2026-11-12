use wasm_bindgen::prelude::wasm_bindgen;
use wasm_bindgen::{JsError, JsValue};
use wf_core::papers::openalex::{self, OpenAlexCandidate};
use wf_core::reader_analysis::text::AnalysisBibliographicHints;

/// [`wf_core::papers::openalex::search_query`]: the query string for a works search.
#[allow(
    clippy::needless_pass_by_value,
    reason = "wasm_bindgen takes optional strings by value"
)]
#[must_use]
#[wasm_bindgen(js_name = openAlexSearchQuery)]
pub fn open_alex_search_query_js(
    search: String,
    mailto: Option<String>,
    api_key: Option<String>,
) -> String {
    openalex::search_query(&search, mailto.as_deref(), api_key.as_deref())
}

/// [`wf_core::papers::openalex::first_match`]: the index of the first matching work, or `undefined`.
///
/// # Errors
///
/// Fails if `hints` or `works` is not of the expected shape.
#[wasm_bindgen(js_name = openAlexFirstMatch)]
pub fn open_alex_first_match_js(
    #[wasm_bindgen(unchecked_param_type = "{ title?: string | null; year?: number | null }")] hints: JsValue,
    #[wasm_bindgen(unchecked_param_type = "{ title?: string | null; publication_year?: number | null }[]")]
    works: JsValue,
) -> Result<Option<u32>, JsError> {
    let hints: AnalysisBibliographicHints = serde_wasm_bindgen::from_value(hints)
        .map_err(|error| JsError::new(&error.to_string()))?;
    let works: Vec<OpenAlexCandidate> = serde_wasm_bindgen::from_value(works)
        .map_err(|error| JsError::new(&error.to_string()))?;
    Ok(openalex::first_match(&hints, &works).and_then(|index| u32::try_from(index).ok()))
}
