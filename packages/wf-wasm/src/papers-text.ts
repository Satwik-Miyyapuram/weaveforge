/**
 * Paper drop rules, PDF titles and figure names (Rust `papers::paper_drop`,
 * `papers::paper_image`), re-exported from index.ts.
 */
import {
  bibImportMessage as rawBibImportMessage,
  guessTitle as rawGuessTitle,
  isBibFile as rawIsBibFile,
  isPdfFile as rawIsPdfFile,
  metadataTitle as rawMetadataTitle,
  paperImageThumbnailPath as rawPaperImageThumbnailPath,
  summarizePdfDrop as rawSummarizePdfDrop,
} from "../pkg/wf_wasm.js";

import type {
  DropEntry as PdfDropEntry,
  PdfDropSummary,
  TitledBy as PdfDropTitledBy,
} from "./bindings.js";

export type { PdfDropEntry, PdfDropSummary, PdfDropTitledBy };

/** Whether a dropped file is a PDF, by its MIME type or its `.pdf` name. */
export function isPdfFile(name: string, mimeType: string): boolean {
  return rawIsPdfFile(name, mimeType);
}

/** Whether a file name is BibTeX (`.bib` or `.bibtex`). */
export function isBibFile(name: string): boolean {
  return rawIsBibFile(name);
}

/** The first opening line of a PDF that reads like a title, if any. */
export function guessTitle(text: string): string | undefined {
  return rawGuessTitle(text);
}

/** The PDF's metadata title, unless it is a tool's placeholder or a file name. */
export function metadataTitle(raw: string | undefined): string | undefined {
  return rawMetadataTitle(raw);
}

/** One toast line for a BibTeX import: what was added, skipped, and unreadable. */
export function bibImportMessage(added: number, skipped: number, problems: number): string {
  return rawBibImportMessage(added, skipped, problems);
}

/** One toast for a whole PDF drop. */
export function summarizePdfDrop(entries: readonly PdfDropEntry[]): PdfDropSummary {
  return rawSummarizePdfDrop(entries) as PdfDropSummary;
}

/** The thumbnail variant name of a figure: `x.full.png` and `x.png` both give `x.thumb.webp`. */
export function paperImageThumbnailPath(path: string): string {
  return rawPaperImageThumbnailPath(path);
}
