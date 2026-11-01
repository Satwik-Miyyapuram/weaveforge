//! Paste cleanup for JavaScript (step 5-2a). Each export wraps a `wf_core::paste`
//! function; the JS shapes match `packages/core/src/paste`.
//!
//! Option objects cross as JS values. Offsets cross as UTF-16 code units, as the
//! editor counts them, and are turned into byte offsets here.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::paste::clean_pasted_text::{clean_pasted_text, paste_lands_in_verbatim_context};
use wf_core::paste::paste_settings::{
    PasteSettings, normalize_paste_settings, parse_link_removal_text,
};
use wf_core::paste::pdf_text::{PdfTextOptions, clean_pdf_text};
use wf_core::paste::quote_commas::{CommaPlacement, apply_comma_placement};
use wf_core::paste::tabular_text::tab_separated_to_markdown_table;
use wf_core::paste::url_cleanup::{build_url_cleanup_options, clean_urls_in_text};
use wf_core::paste::wrapped_text::{WrappedTextOptions, clean_wrapped_text};

use super::{check_text, to_js};

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// The byte offset of UTF-16 offset `utf16` in `text`, floored to a char boundary.
/// An offset past the end clamps to the end.
fn byte_offset(text: &str, utf16: usize) -> usize {
    let mut units = 0;
    for (index, ch) in text.char_indices() {
        let next = units + ch.len_utf16();
        if next > utf16 {
            return index;
        }
        units = next;
    }
    text.len()
}

/// [`clean_pasted_text`] for JS, as `{ text, changed, urlsCleaned }`.
///
/// # Errors
///
/// Fails when `settings` is not a `PasteSettings` object, or `input` is over the text cap.
#[wasm_bindgen(js_name = cleanPastedText)]
pub fn clean_pasted_text_js(input: &str, settings: JsValue) -> JsResult<JsValue> {
    check_text(input)?;
    let settings: PasteSettings = serde_wasm_bindgen::from_value(settings)?;
    to_js(&clean_pasted_text(input, &settings))
}

/// [`paste_lands_in_verbatim_context`] for JS. `offset` is in UTF-16 code units.
///
/// # Errors
///
/// Fails when `document` is over the text cap.
#[wasm_bindgen(js_name = pasteLandsInVerbatimContext)]
pub fn paste_lands_in_verbatim_context_js(document: &str, offset: usize) -> JsResult<bool> {
    check_text(document)?;
    Ok(paste_lands_in_verbatim_context(
        document,
        byte_offset(document, offset),
    ))
}

/// [`clean_wrapped_text`] for JS, as `{ text, changed }`.
///
/// # Errors
///
/// Fails when `options` is not a `WrappedTextOptions` object, or `input` is over the text cap.
#[wasm_bindgen(js_name = cleanWrappedText)]
pub fn clean_wrapped_text_js(input: &str, options: JsValue) -> JsResult<JsValue> {
    check_text(input)?;
    let options: WrappedTextOptions = serde_wasm_bindgen::from_value(options)?;
    to_js(&clean_wrapped_text(input, &options))
}

/// [`clean_pdf_text`] for JS, as `{ text, changed }`.
///
/// # Errors
///
/// Fails when `options` is not a `PdfTextOptions` object, or `input` is over the text cap.
#[wasm_bindgen(js_name = cleanPdfText)]
pub fn clean_pdf_text_js(input: &str, options: JsValue) -> JsResult<JsValue> {
    check_text(input)?;
    let options: PdfTextOptions = serde_wasm_bindgen::from_value(options)?;
    to_js(&clean_pdf_text(input, &options))
}

/// [`apply_comma_placement`] for JS, as `{ text, changed }`.
///
/// # Errors
///
/// Fails when `placement` is not `"inside"` or `"outside"`, or `input` is over the text cap.
#[wasm_bindgen(js_name = applyCommaPlacement)]
pub fn apply_comma_placement_js(input: &str, placement: JsValue) -> JsResult<JsValue> {
    check_text(input)?;
    let placement: CommaPlacement = serde_wasm_bindgen::from_value(placement)?;
    to_js(&apply_comma_placement(input, placement))
}

/// [`tab_separated_to_markdown_table`] for JS, as `{ text, changed }`.
///
/// # Errors
///
/// Fails when `input` is over the text cap.
#[wasm_bindgen(js_name = tabSeparatedToMarkdownTable)]
pub fn tab_separated_to_markdown_table_js(input: &str) -> JsResult<JsValue> {
    check_text(input)?;
    to_js(&tab_separated_to_markdown_table(input))
}

/// Cleans the URLs in `text` with the built-in rules plus the user's `rules`
/// (TS `cleanUrlsInText(text, buildUrlCleanupOptions(rules))`), as `{ text, count }`.
///
/// # Errors
///
/// Fails when `rules` is not a string array, or `text` is over the text cap.
#[wasm_bindgen(js_name = cleanUrlsWithRules)]
pub fn clean_urls_with_rules_js(text: &str, rules: JsValue) -> JsResult<JsValue> {
    check_text(text)?;
    let rules: Vec<String> = serde_wasm_bindgen::from_value(rules)?;
    to_js(&clean_urls_in_text(
        text,
        &build_url_cleanup_options(&rules),
        &[],
    ))
}

/// The default paste settings (TS `DEFAULT_PASTE_SETTINGS`).
///
/// # Errors
///
/// Fails only if the value cannot be converted to a JS value.
#[wasm_bindgen(js_name = defaultPasteSettings)]
pub fn default_paste_settings_js() -> JsResult<JsValue> {
    to_js(&PasteSettings::default())
}

/// [`normalize_paste_settings`] for JS. `json` is `JSON.stringify` of whatever was stored.
///
/// # Errors
///
/// Fails when `json` is not valid JSON or is over the text cap.
#[wasm_bindgen(js_name = normalizePasteSettings)]
pub fn normalize_paste_settings_js(json: &str) -> JsResult<JsValue> {
    check_text(json)?;
    let raw: serde_json::Value =
        serde_json::from_str(json).map_err(serde_wasm_bindgen::Error::new)?;
    to_js(&normalize_paste_settings(&raw))
}

/// [`parse_link_removal_text`] for JS: the textarea's rules, one per line.
///
/// # Errors
///
/// Fails when `text` is over the text cap.
#[wasm_bindgen(js_name = parseLinkRemovalText)]
pub fn parse_link_removal_text_js(text: &str) -> JsResult<JsValue> {
    check_text(text)?;
    to_js(&parse_link_removal_text(text))
}

#[cfg(test)]
mod tests {
    use super::byte_offset;

    #[test]
    fn byte_offset_counts_utf16_units() {
        assert_eq!(byte_offset("abc", 2), 2);
        assert_eq!(byte_offset("é`x`", 1), 2);
        // An astral char is two UTF-16 units and four bytes; mid-pair floors to its start.
        assert_eq!(byte_offset("😀x", 1), 0);
        assert_eq!(byte_offset("😀x", 2), 4);
        assert_eq!(byte_offset("ab", 99), 2);
    }
}
