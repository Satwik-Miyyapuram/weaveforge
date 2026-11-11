/**
 * Paper drop rules, PDF titles and figure names (Rust `papers::paper_drop`,
 * `papers::paper_image`), re-exported from index.ts.
 */
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
  splitPaperDrop,
  summarizePdfDrop,
} from "../pkg/wf_wasm.js";

export type { PdfDropEntry, PdfDropSummary, PdfDropTitledBy };

/** Where each dropped file goes, as indices into the drop: `.bib` files are imported, the rest take the PDF path. */
export interface PaperDropSplit {
  pdfIndices: number[];
  bibIndices: number[];
}

