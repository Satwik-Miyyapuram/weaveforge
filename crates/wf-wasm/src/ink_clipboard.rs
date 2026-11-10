//! The copied figure and stroke clipboard for JavaScript. Wraps `wf_core::ink::clipboard`.
//! Figures and strokes cross as plain objects shaped like `FigureClip`, `FigureBox`,
//! `InkStroke` and `InkPageSize` in `bindings.ts`; a missing parse is `null`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::ink::clipboard::{
    FigureClip, figure_clip_text, parse_figure_clip, parse_stroke_clip, pasted_figure_place,
    pasted_strokes_place, stroke_clip_text,
};
use wf_core::ink::figure::{FigureBox, FigurePlacement};
use wf_core::ink::ink_page::{InkPageSize, InkStroke};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`figure_clip_text`]: the clipboard text for a copied figure.
#[wasm_bindgen(js_name = figureClipText)]
pub fn figure_clip_text_js(
    #[wasm_bindgen(unchecked_param_type = "B.FigureClip")] clip: JsValue,
) -> JsResult<String> {
    let clip: FigureClip = serde_wasm_bindgen::from_value(clip)?;
    Ok(figure_clip_text(&clip))
}

/// [`parse_figure_clip`]: the figure a clipboard text names, or `null`.
#[wasm_bindgen(js_name = parseFigureClip)]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn parse_figure_clip_js(text: Option<String>) -> JsResult<JsValue> {
    to_js(&parse_figure_clip(text.as_deref()))
}

/// [`pasted_figure_place`]: `figure` is a `FigurePlacement`, `on_page` the page's figures, `page` an `InkPageSize`.
#[wasm_bindgen(js_name = pastedFigurePlace, unchecked_return_type = "B.FigurePlacement")]
pub fn pasted_figure_place_js(
    #[wasm_bindgen(unchecked_param_type = "B.FigurePlacement")] figure: JsValue,
    #[wasm_bindgen(unchecked_param_type = "readonly B.FigureBox[]")] on_page: JsValue,
    #[wasm_bindgen(unchecked_param_type = "B.InkPageSize")] page: JsValue,
) -> JsResult<JsValue> {
    let figure: FigurePlacement = serde_wasm_bindgen::from_value(figure)?;
    let on_page: Vec<FigureBox> = serde_wasm_bindgen::from_value(on_page)?;
    let page: InkPageSize = serde_wasm_bindgen::from_value(page)?;
    to_js(&pasted_figure_place(&figure, &on_page, page))
}

/// [`stroke_clip_text`]: the clipboard text for a set of `InkStroke`s.
#[wasm_bindgen(js_name = strokeClipText)]
pub fn stroke_clip_text_js(
    #[wasm_bindgen(unchecked_param_type = "readonly B.InkStroke[]")] strokes: JsValue,
) -> JsResult<String> {
    let strokes: Vec<InkStroke> = serde_wasm_bindgen::from_value(strokes)?;
    Ok(stroke_clip_text(&strokes))
}

/// [`parse_stroke_clip`]: the strokes a clipboard text carries, or `null`.
#[wasm_bindgen(js_name = parseStrokeClip)]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn parse_stroke_clip_js(text: Option<String>) -> JsResult<JsValue> {
    to_js(&parse_stroke_clip(text.as_deref()))
}

/// [`pasted_strokes_place`]: `strokes` are the pasted ones, `on_page` the page's, `page` an `InkPageSize`.
#[wasm_bindgen(js_name = pastedStrokesPlace, unchecked_return_type = "B.InkStroke[]")]
pub fn pasted_strokes_place_js(
    #[wasm_bindgen(unchecked_param_type = "readonly B.InkStroke[]")] strokes: JsValue,
    #[wasm_bindgen(unchecked_param_type = "readonly B.InkStroke[]")] on_page: JsValue,
    #[wasm_bindgen(unchecked_param_type = "B.InkPageSize")] page: JsValue,
) -> JsResult<JsValue> {
    let strokes: Vec<InkStroke> = serde_wasm_bindgen::from_value(strokes)?;
    let on_page: Vec<InkStroke> = serde_wasm_bindgen::from_value(on_page)?;
    let page: InkPageSize = serde_wasm_bindgen::from_value(page)?;
    to_js(&pasted_strokes_place(&strokes, &on_page, page))
}
