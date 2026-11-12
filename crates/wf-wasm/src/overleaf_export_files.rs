//! Overleaf export package build for JavaScript (wf-core `overleaf::export_package`): the texts
//! of `main.tex`, `references.bib`, `manifest.json` and `README.txt`. The caller passes the
//! section walk output, the cite-keyed library and the export date; nothing here reads the clock.

use wasm_bindgen::prelude::wasm_bindgen;
use wasm_bindgen::JsValue;
use wf_core::overleaf::export_package::{BibEntry, ExportPackageInput, build_export_package};

use super::to_js;
use crate::overleaf_bibtex::{bib_paper, get};

type JsResult<T> = Result<T, JsValue>;

/// The caller-facing shapes of the export below.
#[wasm_bindgen(typescript_custom_section)]
const OVERLEAF_EXPORT_FILES_TS: &str = r"
/** What the export package is built from: the section walk output and the export options. */
export interface OverleafExportFilesInput {
  /** Body lines for `main.tex` (the section walk's `out`). */
  body: string[];
  /** Warnings the section walk raised. */
  walkWarnings: string[];
  /** Figures to place under `figures/`. */
  images: OverleafExportImage[];
  sections: number;
  equationsApprox: number;
  figures: number;
  /** Document title; blank or absent uses the default title. */
  title?: string;
  includeBibliography: boolean;
  bibliographyScope?: 'all' | 'cited';
  /** ISO 8601 export time, written into the manifest and README. */
  exportedAt: string;
}

/** A library paper for `references.bib`, with the cite key chosen for it. */
export interface OverleafBibEntryInput {
  paper: BibPaperInput;
  key: string;
}

/** The built export package. */
export interface OverleafExportPackage {
  files: OverleafExportFile[];
  warnings: string[];
  stats: {
    sections: number;
    equationsApprox: number;
    bibliographyEntries: number;
    figures: number;
  };
}
";

/// The export package's files, warnings and stats. `entries` is every library paper (empty when
/// there is none or no bibliography is included).
#[wasm_bindgen(js_name = buildOverleafExportFiles, unchecked_return_type = "OverleafExportPackage")]
pub fn build_overleaf_export_files_js(
    #[wasm_bindgen(unchecked_param_type = "OverleafExportFilesInput")] input: JsValue,
    #[wasm_bindgen(unchecked_param_type = "readonly OverleafBibEntryInput[]")] entries: JsValue,
) -> JsResult<JsValue> {
    let input: ExportPackageInput = serde_wasm_bindgen::from_value(input)?;
    let mut bib_entries = Vec::new();
    for item in js_sys::Array::from(&entries).iter() {
        bib_entries.push(BibEntry {
            paper: bib_paper(&get(&item, "paper")?)?,
            key: get(&item, "key")?.as_string().unwrap_or_default(),
        });
    }
    let package = build_export_package(&input, &bib_entries)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
    to_js(&package).map_err(JsValue::from)
}
