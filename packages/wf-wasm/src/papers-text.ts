/**
 * Paper drop rules, PDF titles and figure names (Rust `papers::paper_drop`,
 * `papers::paper_image`), re-exported from index.ts.
 */
import {
  splitPaperDrop as rawSplitPaperDrop,
  summarizePdfDrop as rawSummarizePdfDrop,
} from "../pkg/wf_wasm.js";

import type {
  DropEntry as PdfDropEntry,
  PdfDropSummary,
  TitledBy as PdfDropTitledBy,
} from "./bindings.js";

export {
  arxivStamp,
  bibImportMessage,
  guessTitle,
  isBibFile,
  isPdfFile,
  isPdfTooLarge,
  metadataTitle,
  paperImageThumbnailPath,
} from "../pkg/wf_wasm.js";

export type { PdfDropEntry, PdfDropSummary, PdfDropTitledBy };

/** Where each dropped file goes, as indices into the drop: `.bib` files are imported, the rest take the PDF path. */
export interface PaperDropSplit {
  pdfIndices: number[];
  bibIndices: number[];
}

/** Splits a drop by file name; every name lands in exactly one list. */
export function splitPaperDrop(names: readonly string[]): PaperDropSplit {
  return rawSplitPaperDrop([...names]) as PaperDropSplit;
}

/** One toast for a whole PDF drop. */
export function summarizePdfDrop(entries: readonly PdfDropEntry[]): PdfDropSummary {
  return rawSummarizePdfDrop(entries) as PdfDropSummary;
}

