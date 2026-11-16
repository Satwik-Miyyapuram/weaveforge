//! The page text for JavaScript: after recognition (wf-core `ink::page_text`) and from a PDF
//! page's text items (wf-core `reader_analysis::lines`). The JS names match
//! `apps/web/src/features/search/application/parts-1.ts` and the handwriting pipeline.

use js_sys::{Array, Reflect};
use wasm_bindgen::prelude::wasm_bindgen;
use wasm_bindgen::{JsCast, JsValue};
use wf_core::ink::page_text::page_text_after_recognition;
use wf_core::reader_analysis::lines::{AnalysisTextRun, page_text_from_items};

/// [`page_text_after_recognition`]: the page text once handwriting has been recognised.
#[wasm_bindgen(js_name = pageTextAfterRecognition)]
pub fn page_text_after_recognition_js(was: &str, prior: &str, recognised: &str) -> String {
    page_text_after_recognition(was, prior, recognised)
}

/// A PDF page's text the way the reader builds it: a newline after each line-ending run.
/// Items whose `str` is not a string (marked content) carry no text and are skipped.
#[wasm_bindgen(js_name = pdfPageText)]
#[must_use]
pub fn pdf_page_text_js(
    #[wasm_bindgen(unchecked_param_type = "readonly unknown[]")] items: &JsValue,
) -> String {
    let array: Array = items.clone().unchecked_into();
    let runs: Vec<(Option<String>, Option<bool>)> = array
        .iter()
        .map(|item| {
            let text = Reflect::get(&item, &JsValue::from_str("str"))
                .ok()
                .and_then(|value| value.as_string());
            let has_eol = Reflect::get(&item, &JsValue::from_str("hasEOL"))
                .ok()
                .and_then(|value| value.as_bool());
            (text, has_eol)
        })
        .collect();
    page_text_from_pairs(runs)
}

/// The runs with a string `str`, joined as [`page_text_from_items`] joins them.
fn page_text_from_pairs(pairs: Vec<(Option<String>, Option<bool>)>) -> String {
    let runs: Vec<AnalysisTextRun> = pairs
        .into_iter()
        .filter_map(|(text, has_eol)| text.map(|str| AnalysisTextRun { str, has_eol }))
        .collect();
    page_text_from_items(&runs)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runs_without_text_are_skipped() {
        let text = page_text_from_pairs(vec![
            (Some("see ".to_owned()), None),
            (None, Some(true)),
            (Some("tail".to_owned()), None),
        ]);
        assert_eq!(text, "see tail");
    }

    #[test]
    fn a_line_ending_run_adds_a_newline() {
        let text = page_text_from_pairs(vec![
            (Some("a".to_owned()), Some(false)),
            (Some("b".to_owned()), Some(true)),
        ]);
        assert_eq!(text, "ab\n");
    }

    #[test]
    fn no_items_give_empty_text() {
        assert_eq!(page_text_from_pairs(Vec::new()), "");
    }
}
