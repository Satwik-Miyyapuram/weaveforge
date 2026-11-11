//! Near-miss vocabulary matching for recognised ink (wf-core `ink::vocab_match`),
//! re-exported from `packages/wf-wasm/src/wrappers-11.ts`.

use wasm_bindgen::prelude::{JsValue, wasm_bindgen};
use wf_core::ink::vocab_match;

use super::to_js;

/// [`damerau_levenshtein`](vocab_match::damerau_levenshtein) as a number.
#[wasm_bindgen(js_name = damerauLevenshtein)]
#[must_use]
pub fn damerau_levenshtein_js(a: &str, b: &str) -> u32 {
    u32::try_from(vocab_match::damerau_levenshtein(a, b)).unwrap_or(u32::MAX)
}

/// [`span_distance`](vocab_match::span_distance); `Infinity` when refused.
///
/// # Errors
///
/// Fails if `words` or `entry_words` is not an array of strings.
#[wasm_bindgen(js_name = spanDistance)]
pub fn span_distance_js(
    #[wasm_bindgen(unchecked_param_type = "readonly string[]")] words: JsValue,
    #[wasm_bindgen(unchecked_param_type = "readonly string[]")] entry_words: JsValue,
) -> Result<f64, serde_wasm_bindgen::Error> {
    let words: Vec<String> = serde_wasm_bindgen::from_value(words)?;
    let entry_words: Vec<String> = serde_wasm_bindgen::from_value(entry_words)?;
    let words: Vec<&str> = words.iter().map(String::as_str).collect();
    let entry_words: Vec<&str> = entry_words.iter().map(String::as_str).collect();
    Ok(
        vocab_match::span_distance(&words, &entry_words).map_or(f64::INFINITY, |distance| {
            f64::from(u32::try_from(distance).unwrap_or(u32::MAX))
        }),
    )
}

/// [`match_vocabulary`](vocab_match::match_vocabulary) as `{ text, matches }`.
///
/// # Errors
///
/// Fails if `vocabulary` is not an array of strings, or the result cannot be serialised.
#[wasm_bindgen(js_name = matchVocabulary, unchecked_return_type = "B.VocabMatchResult")]
pub fn match_vocabulary_js(
    text: &str,
    #[wasm_bindgen(unchecked_param_type = "readonly string[]")] vocabulary: JsValue,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let vocabulary: Vec<String> = serde_wasm_bindgen::from_value(vocabulary)?;
    to_js(&vocab_match::match_vocabulary(text, &vocabulary))
}
