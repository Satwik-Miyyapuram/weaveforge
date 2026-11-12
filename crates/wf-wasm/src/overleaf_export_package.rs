//! Overleaf export package steps for JavaScript (wf-core `overleaf_export_package`): the
//! section walk that builds `main.tex`'s body, and the manifest rewrite for missing figures.

use serde::de::DeserializeOwned;
use wasm_bindgen::prelude::wasm_bindgen;
use wasm_bindgen::{JsError, JsValue};
use wf_core::overleaf_export_package::{
    ExportFile, ExportImage, WalkOptions, walk_sections, with_missing_figures,
};
use wf_core::report::report_section::ReportSectionTreeNode;

use super::to_js;

/// The caller-facing shapes of the exports below. They match `ExportFile`, `ExportImage`,
/// `WalkStats` and `SectionWalk`; the options take a `Map` where `WalkOptions` reads an object.
#[wasm_bindgen(typescript_custom_section)]
const OVERLEAF_EXPORT_TS: &str = r"
/** A file in the export package: its path inside the package and its text. */
export interface OverleafExportFile {
  path: string;
  contents: string;
}

/** A binary figure to fetch and place under `figures/`. */
export interface OverleafExportImage {
  /** Storage path after `reportimg:` (ownerId/sectionId/file). */
  storagePath: string;
  /** Relative ZIP path, e.g. `figures/uuid.webp`. */
  zipPath: string;
}

/** Counts the section walk adds to the export stats. */
export interface OverleafWalkStats {
  sections: number;
  equationsApprox: number;
  figures: number;
}

/** The section walk's result. */
export interface OverleafSectionWalk {
  /** Body lines for `main.tex`. */
  out: string[];
  warnings: string[];
  images: OverleafExportImage[];
  stats: OverleafWalkStats;
}

/** Options for {@link walkOverleafSections}. */
export interface OverleafWalkOptions {
  includeNotes: boolean;
  /** Normalized paper title to bib key; when set, `[[wikilinks]]` become `\cite{key}`. */
  citeByTitle?: ReadonlyMap<string, string>;
}
";

fn parse<T: DeserializeOwned>(value: JsValue) -> Result<T, JsError> {
    serde_wasm_bindgen::from_value(value).map_err(|error| JsError::new(&error.to_string()))
}

#[allow(clippy::needless_pass_by_value)] // `map_err` hands the error over by value.
fn js_error(error: serde_wasm_bindgen::Error) -> JsError {
    JsError::new(&error.to_string())
}

/// `opts` as the object [`WalkOptions`] reads: a truthy `citeByTitle` `Map` becomes a plain
/// object, anything else is left out.
fn walk_options(opts: &JsValue) -> Result<JsValue, JsValue> {
    let wire = js_sys::Object::new();
    let include_notes = js_sys::Reflect::get(opts, &JsValue::from_str("includeNotes"))?;
    let _ = js_sys::Reflect::set(&wire, &JsValue::from_str("includeNotes"), &include_notes)?;
    let cite_by_title = js_sys::Reflect::get(opts, &JsValue::from_str("citeByTitle"))?;
    let cite_by_title = if cite_by_title.is_truthy() {
        js_sys::Object::from_entries(&cite_by_title)?.into()
    } else {
        JsValue::UNDEFINED
    };
    let _ = js_sys::Reflect::set(&wire, &JsValue::from_str("citeByTitle"), &cite_by_title)?;
    Ok(wire.into())
}

/// [`walk_sections`] over the report outline: body lines, warnings, figures and counts.
///
/// # Errors
///
/// Fails if `tree` or `opts` has the wrong shape.
#[wasm_bindgen(js_name = walkOverleafSections, unchecked_return_type = "OverleafSectionWalk")]
pub fn walk_overleaf_sections(
    #[wasm_bindgen(unchecked_param_type = "readonly B.ReportSectionTreeNode[]")] tree: JsValue,
    #[wasm_bindgen(unchecked_param_type = "OverleafWalkOptions")] opts: &JsValue,
) -> Result<JsValue, JsValue> {
    let tree: Vec<ReportSectionTreeNode> = parse(tree)?;
    let opts: WalkOptions = parse(walk_options(opts)?)?;
    to_js(&walk_sections(&tree, &opts)).map_err(|error| js_error(error).into())
}

/// [`with_missing_figures`]: the package files with `manifest.json` rewritten for missing
/// figures. Returns a new array.
///
/// # Errors
///
/// Fails if an argument has the wrong shape or `manifest.json` cannot be rewritten.
#[wasm_bindgen(js_name = withMissingFigures, unchecked_return_type = "OverleafExportFile[]")]
pub fn overleaf_with_missing_figures(
    #[wasm_bindgen(unchecked_param_type = "readonly OverleafExportFile[]")] files: JsValue,
    #[wasm_bindgen(unchecked_param_type = "readonly OverleafExportImage[]")] missing: JsValue,
) -> Result<JsValue, JsError> {
    let files: Vec<ExportFile> = parse(files)?;
    let missing: Vec<ExportImage> = parse(missing)?;
    let out =
        with_missing_figures(&files, &missing).map_err(|error| JsError::new(&error.to_string()))?;
    to_js(&out).map_err(js_error)
}
