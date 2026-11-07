/**
 * `.bib` import (Rust `papers::bib_import`), re-exported from index.ts.
 */
import { planBibImport as rawPlanBibImport } from "../pkg/wf_wasm.js";
import type { BibImportPlan } from "./bindings.js";

export type { BibImportPaper, BibImportPlan, BibImportSkip } from "./bindings.js";

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
