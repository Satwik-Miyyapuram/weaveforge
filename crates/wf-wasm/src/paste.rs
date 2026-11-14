//! Paste cleanup for JavaScript (step 5-2a). Each export wraps a `wf_core::paste`
//! function; the JS shapes match `packages/core/src/paste`.
//!
//! Option objects cross as JS values. Offsets cross as UTF-16 code units, as the
//! editor counts them, and are turned into byte offsets here.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::paste::clean_pasted_text::{clean_pasted_text, paste_lands_in_verbatim_context};
use wf_core::paste::html_to_markdown::html_to_markdown;
use wf_core::paste::markdown_link::{escape_link_label, is_bare_url, link_label, markdown_link};
use wf_core::paste::paste_settings::{
    PasteSettings, normalize_paste_settings, parse_link_removal_text,
};
use wf_core::paste::pdf_text::{PdfTextOptions, clean_pdf_text};
use wf_core::paste::quote_commas::{CommaPlacement, apply_comma_placement};
use wf_core::paste::tabular_text::tab_separated_to_markdown_table;
use wf_core::paste::url_cleanup::{build_url_cleanup_options, clean_urls_in_text};
use wf_core::paste::wrapped_text::{WrappedTextOptions, clean_wrapped_text};

use super::to_js;

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
#[wasm_bindgen(js_name = cleanPastedText, unchecked_return_type = "B.CleanPasteResult")]
pub fn clean_pasted_text_js(
    input: js_sys::JsString,
    #[wasm_bindgen(unchecked_param_type = "B.PasteSettings")] settings: JsValue,
) -> JsResult<JsValue> {
    let input = &crate::guarded_text(&input)?;
    let settings: PasteSettings = serde_wasm_bindgen::from_value(settings)?;
    to_js(&clean_pasted_text(input, &settings))
}

/// [`paste_lands_in_verbatim_context`] for JS. `offset` is in UTF-16 code units; it is
/// floored, and a negative offset reads as 0.
///
/// # Errors
///
/// Fails when `document` is over the text cap.
#[wasm_bindgen(js_name = pasteLandsInVerbatimContext)]
pub fn paste_lands_in_verbatim_context_js(
    document: js_sys::JsString,
    offset: f64,
) -> JsResult<bool> {
    let document = &crate::guarded_text(&document)?;
    Ok(paste_lands_in_verbatim_context(
        document,
        byte_offset(document, utf16_offset(offset)),
    ))
}

/// `Math.max(0, Math.floor(offset))` as a JS `usize` argument reads it: a non-finite value
/// is 0, and a finite one wraps modulo 2^32.
#[allow(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    reason = "the value is a non-negative whole number below 2^32"
)]
fn utf16_offset(offset: f64) -> usize {
    if offset.is_finite() {
        (offset.floor().max(0.0) % 4_294_967_296.0) as usize
    } else {
        0
    }
}

/// [`clean_wrapped_text`] for JS, as `{ text, changed }`.
///
/// # Errors
///
/// Fails when `options` is not a `WrappedTextOptions` object, or `input` is over the text cap.
#[wasm_bindgen(js_name = cleanWrappedText, unchecked_return_type = "B.TextResult")]
pub fn clean_wrapped_text_js(
    input: js_sys::JsString,
    #[wasm_bindgen(unchecked_param_type = "B.WrappedTextOptions")] options: JsValue,
) -> JsResult<JsValue> {
    let input = &crate::guarded_text(&input)?;
    let options: WrappedTextOptions = serde_wasm_bindgen::from_value(options)?;
    to_js(&clean_wrapped_text(input, &options))
}

/// [`clean_pdf_text`] for JS, as `{ text, changed }`.
///
/// # Errors
///
/// Fails when `options` is not a `PdfTextOptions` object, or `input` is over the text cap.
#[wasm_bindgen(js_name = cleanPdfText, unchecked_return_type = "B.TextResult")]
pub fn clean_pdf_text_js(
    input: js_sys::JsString,
    #[wasm_bindgen(unchecked_param_type = "B.PdfTextOptions")] options: JsValue,
) -> JsResult<JsValue> {
    let input = &crate::guarded_text(&input)?;
    let options: PdfTextOptions = serde_wasm_bindgen::from_value(options)?;
    to_js(&clean_pdf_text(input, &options))
}

/// [`apply_comma_placement`] for JS, as `{ text, changed }`.
///
/// # Errors
///
/// Fails when `placement` is not `"inside"` or `"outside"`, or `input` is over the text cap.
#[wasm_bindgen(js_name = applyCommaPlacement, unchecked_return_type = "B.TextResult")]
pub fn apply_comma_placement_js(
    input: js_sys::JsString,
    #[wasm_bindgen(unchecked_param_type = "B.CommaPlacement")] placement: JsValue,
) -> JsResult<JsValue> {
    let input = &crate::guarded_text(&input)?;
    let placement: CommaPlacement = serde_wasm_bindgen::from_value(placement)?;
    to_js(&apply_comma_placement(input, placement))
}

/// [`tab_separated_to_markdown_table`] for JS, as `{ text, changed }`.
///
/// # Errors
///
/// Fails when `input` is over the text cap.
#[wasm_bindgen(js_name = tabSeparatedToMarkdownTable, unchecked_return_type = "B.TextResult")]
pub fn tab_separated_to_markdown_table_js(input: js_sys::JsString) -> JsResult<JsValue> {
    let input = &crate::guarded_text(&input)?;
    to_js(&tab_separated_to_markdown_table(input))
}

/// [`html_to_markdown`] for JS: clipboard HTML in, Markdown out.
///
/// # Errors
///
/// Fails when `html` is over the text cap.
#[wasm_bindgen(js_name = htmlToMarkdown)]
pub fn html_to_markdown_js(html: js_sys::JsString) -> JsResult<String> {
    let html = &crate::guarded_text(&html)?;
    Ok(html_to_markdown(html))
}

/// Cleans the URLs in `text` with the built-in rules plus the user's `rules`
/// (TS `cleanUrlsInText(text, buildUrlCleanupOptions(rules))`), as `{ text, count }`.
///
/// # Errors
///
/// Fails when `rules` is not a string array, or `text` is over the text cap.
#[wasm_bindgen(js_name = cleanUrlsWithRules, unchecked_return_type = "B.UrlCleanupResult")]
pub fn clean_urls_with_rules_js(
    text: js_sys::JsString,
    #[wasm_bindgen(unchecked_param_type = "readonly string[]")] rules: JsValue,
) -> JsResult<JsValue> {
    let text = &crate::guarded_text(&text)?;
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
#[wasm_bindgen(js_name = defaultPasteSettings, unchecked_return_type = "B.PasteSettings")]
pub fn default_paste_settings_js() -> JsResult<JsValue> {
    to_js(&PasteSettings::default())
}

/// [`normalize_paste_settings`] for JS: settings the pipeline can trust from whatever was
/// stored. A value `JSON.stringify` drops (such as `undefined`) reads as `null`.
///
/// # Errors
///
/// Rethrows what `JSON.stringify` throws; fails when the JSON is over the text cap.
#[wasm_bindgen(js_name = normalizePasteSettings, unchecked_return_type = "B.PasteSettings")]
pub fn normalize_paste_settings_js(
    #[wasm_bindgen(unchecked_param_type = "unknown")] raw: &JsValue,
) -> Result<JsValue, JsValue> {
    let json = js_sys::JSON::stringify(raw)?;
    let json = if json.is_undefined() {
        js_sys::JsString::from("null")
    } else {
        json
    };
    let json = &crate::guarded_text(&json)?;
    let raw: serde_json::Value =
        serde_json::from_str(json).map_err(serde_wasm_bindgen::Error::new)?;
    Ok(to_js(&normalize_paste_settings(&raw))?)
}

/// [`parse_link_removal_text`] for JS: the textarea's rules, one per line.
///
/// # Errors
///
/// Fails when `text` is over the text cap.
#[wasm_bindgen(js_name = parseLinkRemovalText, unchecked_return_type = "string[]")]
pub fn parse_link_removal_text_js(text: js_sys::JsString) -> JsResult<JsValue> {
    let text = &crate::guarded_text(&text)?;
    to_js(&parse_link_removal_text(text))
}

/// [`is_bare_url`] for JS: whether `text` is one http(s) address (TS `BARE_URL.test`).
#[wasm_bindgen(js_name = isBareUrl)]
pub fn is_bare_url_js(text: js_sys::JsString) -> JsResult<bool> {
    let text = &crate::guarded_text(&text)?;
    Ok(is_bare_url(text))
}

/// [`escape_link_label`] for JS.
#[wasm_bindgen(js_name = escapeLinkLabel)]
pub fn escape_link_label_js(label: js_sys::JsString) -> JsResult<String> {
    let label = &crate::guarded_text(&label)?;
    Ok(escape_link_label(label))
}

/// [`markdown_link`] for JS: `[label](url)`.
#[wasm_bindgen(js_name = markdownLink)]
pub fn markdown_link_js(label: js_sys::JsString, url: js_sys::JsString) -> JsResult<String> {
    let label = &crate::guarded_text(&label)?;
    let url = &crate::guarded_text(&url)?;
    Ok(markdown_link(label, url))
}

/// [`link_label`] for JS: the label, or `null` for an empty or multi-line selection.
#[wasm_bindgen(js_name = linkLabel, unchecked_return_type = "string | null")]
pub fn link_label_js(selected: js_sys::JsString) -> JsResult<JsValue> {
    let selected = &crate::guarded_text(&selected)?;
    Ok(link_label(selected).map_or(JsValue::NULL, JsValue::from))
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
