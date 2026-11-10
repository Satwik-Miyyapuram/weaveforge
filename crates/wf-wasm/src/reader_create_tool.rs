//! Create-tool rules (`apps/web/src/features/reader/application/reader-annotation-helpers.ts`
//! and `ui/pdf-reader/colour-tools.ts`). Wraps `wf_core::reader::create_tool`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::reader::create_tool::{
    PagePress, colour_tool_for, is_dismiss_tap, is_ink_tool, mark_colour_tool, tool_owns_the_page,
};

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`is_ink_tool`]: `ink` and `highlighter` draw on the page.
#[wasm_bindgen(js_name = isInkTool)]
pub fn is_ink_tool_js(tool: &str) -> bool {
    is_ink_tool(tool)
}

/// [`tool_owns_the_page`]: every tool but `select` takes the page from the text selection.
#[wasm_bindgen(js_name = toolOwnsThePage)]
pub fn tool_owns_the_page_js(tool: &str) -> bool {
    tool_owns_the_page(tool)
}

/// [`is_dismiss_tap`]: `down` and `up` are `{ x, y, time }`; `down` may be `null`.
///
/// # Errors
///
/// Fails if `down` or `up` is not a press object of numbers.
#[wasm_bindgen(js_name = isDismissTap)]
pub fn is_dismiss_tap_js(
    #[wasm_bindgen(unchecked_param_type = "B.PagePress | null")] down: JsValue,
    #[wasm_bindgen(unchecked_param_type = "B.PagePress")] up: JsValue,
    bar_open: bool,
) -> JsResult<bool> {
    let down: Option<PagePress> = serde_wasm_bindgen::from_value(down)?;
    let up: PagePress = serde_wasm_bindgen::from_value(up)?;
    Ok(is_dismiss_tap(down, up, bar_open))
}

/// [`colour_tool_for`]: returns `"pen"`, `"highlighter"`, `"text"` or `"highlight"`.
#[wasm_bindgen(js_name = colourToolFor)]
pub fn colour_tool_for_js(pen_open: bool, pen_tool: &str, picked_tool: &str) -> String {
    colour_tool_for(pen_open, pen_tool, picked_tool).to_owned()
}

/// [`mark_colour_tool`]: returns `"pen"`, `"highlight"`, `"underline"` or `"text"`.
#[wasm_bindgen(js_name = markColourTool)]
pub fn mark_colour_tool_js(mark_type: &str) -> String {
    mark_colour_tool(mark_type).to_owned()
}
