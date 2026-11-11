/**
 * `.bib` import (Rust `papers::bib_import`), re-exported from index.ts.
 */
import { citeKeyOf as rawCiteKeyOf } from "../pkg/wf_wasm.js";

export {
  bibPaperInput,
  planBibImport,
} from "../pkg/wf_wasm.js";
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

/** The citation key of a paper's metadata bag, when it is a string that is not blank. */
export function citeKeyOf(metadata: unknown): string | undefined {
  return (rawCiteKeyOf(metadata) as string | undefined) ?? undefined;
}
