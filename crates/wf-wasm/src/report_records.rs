//! Report rules for JavaScript (wf-core `report::prisma_figure`, `report::project_path`,
//! `report::bibliography_report` and `report::report_section`). The JS names match the TS files
//! of the same name in `packages/core/src/features/report/domain`.
//!
//! The TS wrappers in `packages/wf-wasm/src/report-records.ts` convert `.bib` field records,
//! draw the section id and time, and apply the `null` handling.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::report::bibliography_report::{self, BibliographyInput};
use wf_core::report::edited_label;
use wf_core::report::prisma_figure::{self, PrismaCounts, PrismaFigureOptions};
use wf_core::report::project_path;
use wf_core::report::report_section::{
    self, NewReportSectionInput, ReportSection, ReportSectionTreeNode,
};
use wf_core::report::section_progress;
use wf_core::report::section_sources;

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`prisma_figure_tex`](prisma_figure::prisma_figure_tex) (TS `prismaFigureTex`).
///
/// # Errors
///
/// Fails if `counts` or `options` has the wrong shape.
#[wasm_bindgen(js_name = prismaFigureTex)]
pub fn prisma_figure_tex_js(counts: JsValue, options: JsValue) -> JsResult<String> {
    let counts: PrismaCounts = serde_wasm_bindgen::from_value(counts)?;
    let options: PrismaFigureOptions = serde_wasm_bindgen::from_value(options)?;
    Ok(prisma_figure::prisma_figure_tex(&counts, &options))
}

/// [`prisma_caveat`](prisma_figure::prisma_caveat) (TS `prismaCaveat`). `None` becomes `undefined`.
///
/// # Errors
///
/// Fails if `counts` has the wrong shape.
#[wasm_bindgen(js_name = prismaCaveat)]
pub fn prisma_caveat_js(counts: JsValue) -> JsResult<Option<String>> {
    let counts: PrismaCounts = serde_wasm_bindgen::from_value(counts)?;
    Ok(prisma_figure::prisma_caveat(&counts))
}

/// [`count_section_sources`](section_sources::count_section_sources) (TS `countSectionSources`).
/// An absent or empty body counts 0.
#[wasm_bindgen(js_name = countSectionSources)]
#[must_use]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs an owned Option<String>.
pub fn count_section_sources_js(body: Option<String>) -> u32 {
    u32::try_from(section_sources::count_section_sources(body.as_deref())).unwrap_or(u32::MAX)
}

/// [`edited_relative_label`](edited_label::edited_relative_label) (TS `editedRelativeLabel`).
/// `None` (a week or more, or NaN) becomes `undefined`; the caller then shows the date.
#[wasm_bindgen(js_name = editedRelativeLabel)]
#[must_use]
pub fn edited_relative_label_js(seconds: f64) -> Option<String> {
    edited_label::edited_relative_label(seconds)
}

/// [`normalize_project_path`](project_path::normalize_project_path) (TS `normalizeProjectPath`).
/// `None` becomes `undefined`.
#[wasm_bindgen(js_name = normalizeProjectPath)]
#[must_use]
pub fn normalize_project_path_js(path: &str) -> Option<String> {
    project_path::normalize_project_path(path)
}

/// [`check_bibliography`](bibliography_report::check_bibliography) (TS `checkBibliography`).
/// Each entry's fields cross as an ordered `{ name, value }` list.
///
/// # Errors
///
/// Fails if `input` has the wrong shape.
#[wasm_bindgen(js_name = checkBibliography)]
pub fn check_bibliography_js(input: JsValue) -> JsResult<JsValue> {
    let input: BibliographyInput = serde_wasm_bindgen::from_value(input)?;
    to_js(&bibliography_report::check_bibliography(&input))
}

/// [`validate_report_section_input`](report_section::validate_report_section_input): the
/// validation message, or `undefined` when the input is valid.
///
/// # Errors
///
/// Fails if `input` has the wrong shape.
#[wasm_bindgen(js_name = reportSectionInputError)]
pub fn report_section_input_error_js(input: JsValue) -> JsResult<Option<String>> {
    let input: NewReportSectionInput = serde_wasm_bindgen::from_value(input)?;
    Ok(report_section::validate_report_section_input(&input).err())
}

/// [`create_report_section`](report_section::create_report_section) with the id and time
/// supplied. Call [`report_section_input_error_js`] first: invalid input fails here.
///
/// # Errors
///
/// Fails if `input` has the wrong shape or does not validate.
#[wasm_bindgen(js_name = createReportSectionWith)]
pub fn create_report_section_js(
    input: JsValue,
    id: &str,
    now_iso: &str,
) -> Result<JsValue, JsValue> {
    let input: NewReportSectionInput = serde_wasm_bindgen::from_value(input)?;
    let section = report_section::create_report_section(&input, id, now_iso)
        .map_err(|message| JsValue::from_str(&message))?;
    Ok(to_js(&section)?)
}

/// [`build_section_tree`](report_section::build_section_tree) (TS `buildSectionTree`).
///
/// # Errors
///
/// Fails if `sections` is not a list of sections.
#[wasm_bindgen(js_name = buildSectionTree)]
pub fn build_section_tree_js(sections: JsValue) -> JsResult<JsValue> {
    let sections: Vec<ReportSection> = serde_wasm_bindgen::from_value(sections)?;
    to_js(&report_section::build_section_tree(sections))
}

/// [`section_progress`](section_progress::section_progress) (TS `sectionProgress`).
///
/// # Errors
///
/// Fails if `node` is not a section tree node.
#[wasm_bindgen(js_name = sectionProgress)]
pub fn section_progress_js(node: JsValue) -> JsResult<JsValue> {
    let node: ReportSectionTreeNode = serde_wasm_bindgen::from_value(node)?;
    to_js(&section_progress::section_progress(&node))
}

/// [`outline_progress`](section_progress::outline_progress) (TS `outlineProgress`).
///
/// # Errors
///
/// Fails if `roots` is not a list of section tree nodes.
#[wasm_bindgen(js_name = outlineProgress)]
pub fn outline_progress_js(roots: JsValue) -> JsResult<JsValue> {
    let roots: Vec<ReportSectionTreeNode> = serde_wasm_bindgen::from_value(roots)?;
    to_js(&section_progress::outline_progress(&roots))
}
