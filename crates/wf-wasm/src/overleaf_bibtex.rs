//! Overleaf BibTeX export helpers (wf-core `overleaf::bibtex`). The paper input is the
//! subset of `Paper` the entries read (`BibPaperInput`); a `Paper` satisfies it. The
//! cite-key fields are flattened from `metadata` here, as [`BibPaper`] has them at the top.

use wasm_bindgen::prelude::wasm_bindgen;
use wasm_bindgen::{JsCast, JsValue};
use wf_core::overleaf::bibtex::{self, BibPaper};

use super::to_js;

type JsResult<T> = Result<T, JsValue>;

/// The paper fields a `.bib` entry reads, as a `Paper` supplies them.
#[wasm_bindgen(typescript_custom_section)]
const BIB_PAPER_INPUT_TS: &str = r"
/** The paper fields a `.bib` entry reads, as a `Paper` supplies them. */
export interface BibPaperInput {
  id: string;
  title: string;
  authors?: readonly string[];
  year?: number;
  venue?: string;
  doi?: string;
  arxivId?: string;
  url?: string;
  bibtex?: string;
  metadata?: Record<string, unknown>;
}
";

/// `object[key]`, or `undefined` when `object` is not an object.
pub(crate) fn get(object: &JsValue, key: &str) -> JsResult<JsValue> {
    if object.is_object() {
        js_sys::Reflect::get(object, &JsValue::from_str(key))
    } else {
        Ok(JsValue::UNDEFINED)
    }
}

/// `value` when it is a string, else `undefined`.
fn string_field(value: JsValue) -> JsValue {
    if value.is_string() {
        value
    } else {
        JsValue::UNDEFINED
    }
}

/// One `BibPaperInput` as a [`BibPaper`]: authors copied (absent reads as none), `year`
/// only when it is a number, and `citeKey` / `citationKey` / `extra` taken from
/// `metadata` when they are strings.
pub(crate) fn bib_paper(paper: &JsValue) -> JsResult<BibPaper> {
    let wire = js_sys::Object::new();
    let set =
        |key: &str, value: &JsValue| js_sys::Reflect::set(&wire, &JsValue::from_str(key), value);
    let _ = set("id", &get(paper, "id")?)?;
    let _ = set("title", &get(paper, "title")?)?;
    let authors = get(paper, "authors")?;
    let authors = if authors.is_null() || authors.is_undefined() {
        js_sys::Array::new()
    } else {
        js_sys::Array::from(&authors)
    };
    let _ = set("authors", &authors)?;
    let year = get(paper, "year")?;
    let _ = set(
        "year",
        &if year.as_f64().is_some() {
            year
        } else {
            JsValue::UNDEFINED
        },
    )?;
    for key in ["venue", "doi", "arxivId", "url", "bibtex"] {
        let _ = set(key, &get(paper, key)?)?;
    }
    let meta = get(paper, "metadata")?;
    for key in ["citeKey", "citationKey", "extra"] {
        let _ = set(key, &string_field(get(&meta, key)?))?;
    }
    Ok(serde_wasm_bindgen::from_value(wire.into())?)
}

/// Reads a JS array of `BibPaperInput`s into the Rust paper list.
fn papers(value: &JsValue) -> JsResult<Vec<BibPaper>> {
    let array = value
        .dyn_ref::<js_sys::Array>()
        .ok_or_else(|| js_sys::TypeError::new("papers must be an array"))?;
    array.iter().map(|paper| bib_paper(&paper)).collect()
}

/// [`paper_cite_keys`](bibtex::paper_cite_keys) (TS `buildCiteByTitle`'s key list): one key per
/// paper, in order, unique across the list.
///
/// # Errors
///
/// Fails if `papers` is not an array of paper objects.
#[wasm_bindgen(js_name = paperCiteKeys, unchecked_return_type = "string[]")]
pub fn paper_cite_keys_js(
    #[wasm_bindgen(unchecked_param_type = "readonly BibPaperInput[]")] papers_value: &JsValue,
) -> JsResult<JsValue> {
    Ok(to_js(&bibtex::paper_cite_keys(&papers(papers_value)?))?)
}

/// [`collect_cited_keys`](bibtex::collect_cited_keys): the keys a LaTeX body cites, from its
/// `\cite{...}` commands, as a JS `Set`.
#[wasm_bindgen(js_name = collectCitedKeys, unchecked_return_type = "Set<string>")]
#[must_use]
pub fn collect_cited_keys_js(latex: &str) -> JsValue {
    let keys = js_sys::Set::new(&JsValue::UNDEFINED);
    for key in bibtex::collect_cited_keys(latex) {
        let _ = keys.add(&JsValue::from_str(&key));
    }
    keys.into()
}

/// [`paper_to_bibtex`](bibtex::paper_to_bibtex): one `.bib` entry under `key`.
///
/// # Errors
///
/// Fails if `paper` is not a paper object.
#[wasm_bindgen(js_name = paperToBibtex)]
pub fn paper_to_bibtex_js(
    #[wasm_bindgen(unchecked_param_type = "BibPaperInput")] paper: &JsValue,
    key: &str,
) -> JsResult<String> {
    Ok(bibtex::paper_to_bibtex(&bib_paper(paper)?, key))
}

/// [`join_bibtex`](bibtex::join_bibtex): entries joined with a blank line, or `% (empty)`.
///
/// # Errors
///
/// Fails if `entries` is not an array of strings.
#[wasm_bindgen(js_name = joinBibtex)]
pub fn join_bibtex_js(
    #[wasm_bindgen(unchecked_param_type = "readonly string[]")] entries: JsValue,
) -> JsResult<String> {
    let entries: Vec<String> = serde_wasm_bindgen::from_value(entries)?;
    Ok(bibtex::join_bibtex(&entries))
}

/// [`library_bibtex`](bibtex::library_bibtex): the whole library as one `.bib`.
///
/// # Errors
///
/// Fails if `papers` is not an array of paper objects.
#[wasm_bindgen(js_name = libraryBibtex)]
pub fn library_bibtex_js(
    #[wasm_bindgen(unchecked_param_type = "readonly BibPaperInput[]")] papers_value: &JsValue,
) -> JsResult<String> {
    Ok(bibtex::library_bibtex(&papers(papers_value)?))
}
