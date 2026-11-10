//! Local annotation drafts (`apps/web/src/features/reader/application/draft-local-annotation.ts`).
//! Wraps `wf_core::reader::annotation_draft`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::reader::anchor::AnchorCombinedPdf;
use wf_core::reader::annotation_draft::{
    ImageRegionDraft, InkDraft, TextBoxDraft, TextSelectionDraft, append_ink_stroke,
    draft_from_text_selection, draft_image_region, draft_ink_annotation, draft_text_box,
    erase_ink_paths, grown_text_rect, text_box_from_rect,
};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`draft_from_text_selection`]: `null` when the selection has no placeable text.
///
/// # Errors
///
/// Fails if `input` is not a text-selection draft.
#[wasm_bindgen(js_name = draftFromTextSelection, unchecked_return_type = "B.NewReaderAnnotation | null")]
pub fn draft_from_text_selection_js(
    #[wasm_bindgen(unchecked_param_type = "B.TextSelectionDraft")] input: JsValue,
) -> JsResult<JsValue> {
    let input: TextSelectionDraft = serde_wasm_bindgen::from_value(input)?;
    to_js(&draft_from_text_selection(&input))
}

/// [`draft_ink_annotation`]: the ink mark to save, or `null` when nothing was drawn.
///
/// # Errors
///
/// Fails if `input` is not an ink draft.
#[wasm_bindgen(js_name = draftInkAnnotation, unchecked_return_type = "B.NewReaderAnnotation | null")]
pub fn draft_ink_annotation_js(
    #[wasm_bindgen(unchecked_param_type = "B.InkDraft")] input: JsValue,
) -> JsResult<JsValue> {
    let input: InkDraft = serde_wasm_bindgen::from_value(input)?;
    to_js(&draft_ink_annotation(&input))
}

/// [`append_ink_stroke`]: the anchor with one more path, or `null` for a stroke too short to keep.
///
/// # Errors
///
/// Fails if `anchor` or `path` is malformed.
#[wasm_bindgen(js_name = appendInkStroke)]
pub fn append_ink_stroke_js(anchor: JsValue, path: JsValue) -> JsResult<JsValue> {
    let anchor: AnchorCombinedPdf = serde_wasm_bindgen::from_value(anchor)?;
    let path: Vec<f64> = serde_wasm_bindgen::from_value(path)?;
    to_js(&append_ink_stroke(&anchor, &path))
}

/// [`erase_ink_paths`]: the anchor with the paths under the eraser removed, or `null` when all were removed.
///
/// # Errors
///
/// Fails if `anchor` is malformed.
#[wasm_bindgen(js_name = eraseInkPaths)]
pub fn erase_ink_paths_js(anchor: JsValue, x: f64, y: f64, radius: f64) -> JsResult<JsValue> {
    let anchor: AnchorCombinedPdf = serde_wasm_bindgen::from_value(anchor)?;
    to_js(&erase_ink_paths(anchor, x, y, radius))
}

/// [`draft_image_region`]: a region mark, or `null` for an empty region.
///
/// # Errors
///
/// Fails if `input` is not an image-region draft.
#[wasm_bindgen(js_name = draftImageRegion, unchecked_return_type = "B.NewReaderAnnotation | null")]
pub fn draft_image_region_js(
    #[wasm_bindgen(unchecked_param_type = "B.ImageRegionDraft")] input: JsValue,
) -> JsResult<JsValue> {
    let input: ImageRegionDraft = serde_wasm_bindgen::from_value(input)?;
    to_js(&draft_image_region(&input))
}

/// [`grown_text_rect`]: a `[x1, y1, x2, y2]` rect grown to at least `height`.
///
/// # Errors
///
/// Fails if `rect` is not four numbers.
#[wasm_bindgen(js_name = grownTextRect)]
pub fn grown_text_rect_js(rect: JsValue, height: f64) -> JsResult<JsValue> {
    let rect: [f64; 4] = serde_wasm_bindgen::from_value(rect)?;
    to_js(&grown_text_rect(rect, height))
}

/// [`text_box_from_rect`]: a text box's rect as `{ left, top, width, height }` in page units.
///
/// # Errors
///
/// Fails if `rect` is not four numbers.
#[wasm_bindgen(js_name = textBoxFromRect)]
pub fn text_box_from_rect_js(rect: JsValue) -> JsResult<JsValue> {
    let rect: [f64; 4] = serde_wasm_bindgen::from_value(rect)?;
    to_js(&text_box_from_rect(rect))
}

/// [`draft_text_box`]: a text-box mark.
///
/// # Errors
///
/// Fails if `input` is not a text-box draft.
#[wasm_bindgen(js_name = draftTextBox, unchecked_return_type = "B.NewReaderAnnotation")]
pub fn draft_text_box_js(
    #[wasm_bindgen(unchecked_param_type = "B.TextBoxDraft")] input: JsValue,
) -> JsResult<JsValue> {
    let input: TextBoxDraft = serde_wasm_bindgen::from_value(input)?;
    to_js(&draft_text_box(&input))
}
