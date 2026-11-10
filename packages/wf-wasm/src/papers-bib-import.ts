/**
 * `.bib` import (Rust `papers::bib_import`), re-exported from index.ts.
 */
import {
  bibPaperInput as rawBibPaperInput,
  citeKeyOf as rawCiteKeyOf,
  planBibImport as rawPlanBibImport,
} from "../pkg/wf_wasm.js";
import type { BibImportPaper, BibImportPlan } from "./bindings.js";

export type { BibImportPaper, BibImportPlan, BibImportSkip } from "./bindings.js";

/** The fields a new paper takes from a planned entry, as the add call reads them. */
export type BibPaperInputRow = {
  title: string;
  authors: string[];
  year?: number;
  venue?: string;
  doi?: string;
  arxivId?: string;
  url?: string;
  abstract?: string;
  bibtex: string;
  metadata: { citeKey: string };
};

/** The save fields of one planned entry; absent values are left out (`undefined`). */
export function bibPaperInput(entry: BibImportPaper): BibPaperInputRow {
  return rawBibPaperInput(entry) as BibPaperInputRow;
}

/** The citation key of a paper's metadata bag, when it is a string that is not blank. */
export function citeKeyOf(metadata: unknown): string | undefined {
  return (rawCiteKeyOf(metadata) as string | undefined) ?? undefined;
}

/**
 * The papers a `.bib` file would add, the duplicates it would skip (by DOI or
 * citation key) and the broken entries. Saves nothing.
 */
export function planBibImport(
  fileName: string,
  text: string,
  existingDois: readonly string[],
  existingKeys: readonly string[],
): BibImportPlan {
  return rawPlanBibImport(fileName, text, [...existingDois], [...existingKeys]) as BibImportPlan;
}
