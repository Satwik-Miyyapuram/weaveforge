//! Placed pictures (`apps/web/src/features/reader/application/reader-picture.ts`).
//! Wraps `wf_core::reader::picture`. `picturePath` is exported by `reader_mark_actions`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::reader::annotation_helpers::ReaderAnnotation;
use wf_core::reader::picture::{
    FigureGeometry, PictureDraftInput, PictureMeta, draft_picture, page_pictures, picture_comment,
    picture_meta, picture_rect,
};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`picture_meta`]: the picture's stored file, crop and stacking order, or `null` if not a picture.
///
/// # Errors
///
/// Fails if the result cannot be converted to a JS value.
#[wasm_bindgen(js_name = pictureMeta, unchecked_return_type = "B.PictureMeta | null")]
pub fn picture_meta_js(
    kind: &str,
    #[wasm_bindgen(unchecked_param_type = "string | null | undefined")] comment: Option<String>,
) -> JsResult<JsValue> {
    to_js(&picture_meta(kind, comment.as_deref()))
}

/// [`picture_comment`]: the comment text that stores a picture's crop and stacking order.
///
/// # Errors
///
/// Fails if `meta` is not a picture-metadata object.
#[wasm_bindgen(js_name = pictureComment)]
pub fn picture_comment_js(
    #[wasm_bindgen(unchecked_param_type = "B.PictureMeta")] meta: JsValue,
) -> JsResult<String> {
    let meta: PictureMeta = serde_wasm_bindgen::from_value(meta)?;
    Ok(picture_comment(&meta))
}

/// [`page_pictures`]: the placed pictures on a page, figure-ready and in paint order.
///
/// # Errors
///
/// Fails if `annotations` is not a list of annotations.
#[wasm_bindgen(js_name = pagePictures)]
pub fn page_pictures_js(annotations: JsValue, page_height: f64) -> JsResult<JsValue> {
    let annotations: Vec<ReaderAnnotation> = serde_wasm_bindgen::from_value(annotations)?;
    to_js(&page_pictures(&annotations, page_height))
}

/// [`picture_rect`]: a figure's `[x1, y1, x2, y2]` rect in PDF user space.
///
/// # Errors
///
/// Fails if `figure` is not a figure-geometry object.
#[wasm_bindgen(js_name = pictureRect, unchecked_return_type = "[number, number, number, number]")]
pub fn picture_rect_js(
    #[wasm_bindgen(unchecked_param_type = "B.FigureGeometry")] figure: JsValue,
    page_height: f64,
) -> JsResult<JsValue> {
    let figure: FigureGeometry = serde_wasm_bindgen::from_value(figure)?;
    to_js(&picture_rect(&figure, page_height))
}

/// [`draft_picture`]: a new picture mark sized to half the page at the picture's own aspect.
///
/// # Errors
///
/// Fails if `input` is not a picture-draft object.
#[wasm_bindgen(js_name = draftPicture, unchecked_return_type = "B.NewReaderAnnotation")]
pub fn draft_picture_js(
    #[wasm_bindgen(unchecked_param_type = "B.PictureDraftInput")] input: JsValue,
) -> JsResult<JsValue> {
    let input: PictureDraftInput = serde_wasm_bindgen::from_value(input)?;
    to_js(&draft_picture(&input))
}
