//! Report rules for JavaScript (wf-core `report::prisma_figure`, `report::project_path`,
//! `report::bibliography_report` and `report::report_section`). The JS names match the TS files
//! of the same name in `packages/core/src/features/report/domain`.
//!
//! `.bib` entry `fields` arrive as records and are turned into the ordered `{ name, value }`
//! list wf-core reads. `createReportSection` draws the id and time from the caller's deps.

use js_sys::{Array, Function, Object, Reflect};
use wasm_bindgen::prelude::wasm_bindgen;
use wasm_bindgen::{JsCast, JsValue};
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

/// [`prisma_figure_tex`](prisma_figure::prisma_figure_tex) (TS `prismaFigureTex`): the PRISMA
/// flow diagram as a LaTeX figure. Missing `options` reads as `{}`.
///
/// # Errors
///
/// Fails if `counts` or `options` has the wrong shape.
#[wasm_bindgen(js_name = prismaFigureTex)]
pub fn prisma_figure_tex_js(
    #[wasm_bindgen(unchecked_param_type = "B.PrismaCounts")] counts: JsValue,
    #[wasm_bindgen(
        unchecked_param_type = "Omit<B.PrismaFigureOptions, \"reasons\"> & { reasons?: readonly B.ExclusionReasonCount[] | null }"
    )]
    options: Option<JsValue>,
) -> JsResult<String> {
    let counts: PrismaCounts = serde_wasm_bindgen::from_value(counts)?;
    let options: PrismaFigureOptions = match options {
        Some(options) if !options.is_undefined() => serde_wasm_bindgen::from_value(options)?,
        _ => PrismaFigureOptions::default(),
    };
    Ok(prisma_figure::prisma_figure_tex(&counts, &options))
}

/// [`prisma_caveat`](prisma_figure::prisma_caveat) (TS `prismaCaveat`). `None` becomes `null`.
///
/// # Errors
///
/// Fails if `counts` has the wrong shape.
#[wasm_bindgen(js_name = prismaCaveat, unchecked_return_type = "string | null")]
pub fn prisma_caveat_js(
    #[wasm_bindgen(unchecked_param_type = "B.PrismaCounts")] counts: JsValue,
) -> JsResult<JsValue> {
    let counts: PrismaCounts = serde_wasm_bindgen::from_value(counts)?;
    let caveat = prisma_figure::prisma_caveat(&counts);
    Ok(caveat.map_or(JsValue::NULL, JsValue::from))
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
/// `None` (a week or more, or NaN) becomes `null`; the caller then shows the date.
#[wasm_bindgen(js_name = editedRelativeLabel, unchecked_return_type = "string | null")]
#[must_use]
pub fn edited_relative_label_js(seconds: f64) -> JsValue {
    edited_label::edited_relative_label(seconds).map_or(JsValue::NULL, JsValue::from)
}

/// [`normalize_project_path`](project_path::normalize_project_path) (TS `normalizeProjectPath`).
/// `None` becomes `null`.
#[wasm_bindgen(js_name = normalizeProjectPath, unchecked_return_type = "string | null")]
#[must_use]
pub fn normalize_project_path_js(path: &str) -> JsValue {
    project_path::normalize_project_path(path).map_or(JsValue::NULL, JsValue::from)
}

/// [`check_bibliography`](bibliography_report::check_bibliography) (TS `checkBibliography`):
/// every citation and bibliography finding in the project's sources. Entries carry their
/// fields as a record, as `parseBibEntries` returns them.
///
/// # Errors
///
/// Fails if `input` has the wrong shape.
#[wasm_bindgen(js_name = checkBibliography, unchecked_return_type = "B.BibliographyReport")]
pub fn check_bibliography_js(
    #[wasm_bindgen(
        unchecked_param_type = "{ sources: readonly B.LatexSourceFile[]; bibliography: { entries: readonly (Omit<B.BibEntry, \"fields\"> & { fields: Record<string, string> })[]; warnings: readonly B.BibWarning[] } }"
    )]
    input: JsValue,
) -> JsResult<JsValue> {
    let input: BibliographyInput = serde_wasm_bindgen::from_value(with_field_lists(&input)?)?;
    to_js(&bibliography_report::check_bibliography(&input))
}

/// `target[key]`, or `undefined` when `target` is not an object.
fn get(target: &JsValue, key: &str) -> JsValue {
    if target.is_object() {
        Reflect::get(target, &JsValue::from_str(key)).unwrap_or(JsValue::UNDEFINED)
    } else {
        JsValue::UNDEFINED
    }
}

/// Sets `target[key] = value`.
fn set(target: &Object, key: &str, value: &JsValue) -> JsResult<()> {
    Reflect::set(target, &JsValue::from_str(key), value)
        .map(|_| ())
        .map_err(|_| serde_wasm_bindgen::Error::new("could not set a property"))
}

/// A copy of the `checkBibliography` input whose entries' `fields` records are ordered
/// `{ name, value }` lists. Shapes it cannot read are passed on for serde to reject.
fn with_field_lists(input: &JsValue) -> JsResult<JsValue> {
    let bibliography = get(input, "bibliography");
    let entries = get(&bibliography, "entries");
    if !Array::is_array(&entries) {
        return Ok(input.clone());
    }
    let listed = Array::new();
    for entry in Array::from(&entries).iter() {
        let fields = get(&entry, "fields");
        if !fields.is_object() {
            let _ = listed.push(&entry);
            continue;
        }
        let list = Array::new();
        for pair in Object::entries(fields.unchecked_ref()).iter() {
            let pair = Array::from(&pair);
            let field = Object::new();
            set(&field, "name", &pair.get(0))?;
            set(&field, "value", &pair.get(1))?;
            let _ = list.push(&field);
        }
        let copy = Object::assign(&Object::new(), entry.unchecked_ref());
        set(&copy, "fields", &list)?;
        let _ = listed.push(&copy);
    }
    let bib_copy = Object::assign(&Object::new(), bibliography.unchecked_ref());
    set(&bib_copy, "entries", &listed)?;
    let copy = Object::assign(&Object::new(), input.unchecked_ref());
    set(&copy, "bibliography", &bib_copy)?;
    Ok(copy.into())
}

/// [`validate_report_section_input`](report_section::validate_report_section_input): the
/// validation message, or `null` when the input is valid.
///
/// # Errors
///
/// Fails if `input` has the wrong shape.
#[wasm_bindgen(js_name = reportSectionInputError, unchecked_return_type = "string | null")]
pub fn report_section_input_error_js(
    #[wasm_bindgen(unchecked_param_type = "B.NewReportSectionInput")] input: JsValue,
) -> JsResult<JsValue> {
    let input: NewReportSectionInput = serde_wasm_bindgen::from_value(input)?;
    let message = report_section::validate_report_section_input(&input).err();
    Ok(message.map_or(JsValue::NULL, JsValue::from))
}

/// [`create_report_section`](report_section::create_report_section) with the id and time
/// supplied. Call [`report_section_input_error_js`] first: invalid input fails here.
///
/// # Errors
///
/// Fails if `input` has the wrong shape or does not validate.
#[wasm_bindgen(js_name = createReportSectionWith, unchecked_return_type = "B.ReportSection")]
pub fn create_report_section_js(
    #[wasm_bindgen(unchecked_param_type = "B.NewReportSectionInput")] input: JsValue,
    id: &str,
    now_iso: &str,
) -> Result<JsValue, JsValue> {
    let input: NewReportSectionInput = serde_wasm_bindgen::from_value(input)?;
    let section = report_section::create_report_section(&input, id, now_iso)
        .map_err(|message| JsValue::from_str(&message))?;
    Ok(to_js(&section)?)
}

/// Calls `target[method]()` with `target` as `this`; whatever it throws is rethrown.
fn call_method(target: &JsValue, method: &str) -> Result<JsValue, JsValue> {
    let function: Function = Reflect::get(target, &JsValue::from_str(method))?.dyn_into()?;
    function.call0(target)
}

/// [`create_report_section`](report_section::create_report_section) (TS `createReportSection`):
/// a new section from caller input. Invalid input throws an `Error` named
/// `ReportSectionValidationError` before an id is drawn; then `deps.ids.newId()` and
/// `deps.clock.nowIso()` are called, in that order.
///
/// # Errors
///
/// Throws the validation error, anything the deps throw, or fails if `input` has the wrong
/// shape.
#[wasm_bindgen(js_name = createReportSection, unchecked_return_type = "B.ReportSection")]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn create_report_section_from_deps_js(
    #[wasm_bindgen(unchecked_param_type = "B.NewReportSectionInput")] input: JsValue,
    #[wasm_bindgen(
        unchecked_param_type = "{ clock: { nowIso(): string }; ids: { newId(): string } }"
    )]
    deps: JsValue,
) -> Result<JsValue, JsValue> {
    let input: NewReportSectionInput = serde_wasm_bindgen::from_value(input)?;
    if let Err(message) = report_section::validate_report_section_input(&input) {
        let error = js_sys::Error::new(&message);
        error.set_name("ReportSectionValidationError");
        return Err(error.into());
    }
    let id = call_method(&Reflect::get(&deps, &JsValue::from_str("ids"))?, "newId")?;
    let now = call_method(&Reflect::get(&deps, &JsValue::from_str("clock"))?, "nowIso")?;
    let id: String = serde_wasm_bindgen::from_value(id)?;
    let now: String = serde_wasm_bindgen::from_value(now)?;
    let section = report_section::create_report_section(&input, &id, &now)
        .map_err(|message| JsValue::from_str(&message))?;
    Ok(to_js(&section)?)
}

/// [`build_section_tree`](report_section::build_section_tree) (TS `buildSectionTree`).
///
/// # Errors
///
/// Fails if `sections` is not a list of sections.
#[wasm_bindgen(js_name = buildSectionTree, unchecked_return_type = "B.ReportSectionTreeNode[]")]
pub fn build_section_tree_js(
    #[wasm_bindgen(unchecked_param_type = "readonly B.ReportSection[]")] sections: JsValue,
) -> JsResult<JsValue> {
    let sections: Vec<ReportSection> = serde_wasm_bindgen::from_value(sections)?;
    to_js(&report_section::build_section_tree(sections))
}

/// [`section_progress`](section_progress::section_progress) (TS `sectionProgress`).
///
/// # Errors
///
/// Fails if `node` is not a section tree node.
#[wasm_bindgen(js_name = sectionProgress, unchecked_return_type = "B.SectionProgress")]
pub fn section_progress_js(
    #[wasm_bindgen(unchecked_param_type = "B.ReportSectionTreeNode")] node: JsValue,
) -> JsResult<JsValue> {
    let node: ReportSectionTreeNode = serde_wasm_bindgen::from_value(node)?;
    to_js(&section_progress::section_progress(&node))
}

/// [`outline_progress`](section_progress::outline_progress) (TS `outlineProgress`).
///
/// # Errors
///
/// Fails if `roots` is not a list of section tree nodes.
#[wasm_bindgen(js_name = outlineProgress, unchecked_return_type = "B.SectionProgress")]
pub fn outline_progress_js(
    #[wasm_bindgen(unchecked_param_type = "readonly B.ReportSectionTreeNode[]")] roots: JsValue,
) -> JsResult<JsValue> {
    let roots: Vec<ReportSectionTreeNode> = serde_wasm_bindgen::from_value(roots)?;
    to_js(&section_progress::outline_progress(&roots))
}
