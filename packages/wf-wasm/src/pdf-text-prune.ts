/**
 * PDF text orphan partition (Rust `search::pdf_text_prune`), re-exported from index.ts.
 */
import { partitionPdfTexts as rawPartitionPdfTexts } from "../pkg/wf_wasm.js";
import type { PdfIndexSource } from "./bindings.js";
import type { ReadonlyInput } from "./readonly-input.js";

export interface PdfTextPartition {
  /** Indexes into the input of the texts whose paper still exists, in input order. */
  readonly kept: readonly number[];
  /** Pages held per kept paper; a repeated paper keeps its last count. */
  readonly pageCounts: Map<string, number>;
  /** Paper id of each orphan, in input order; one entry per orphan, so ids may repeat. */
  readonly orphanPaperIds: readonly string[];
}

/** Splits stored PDF texts by whether their paper id is in `paperIds`. */
export function partitionPdfTexts(
  stored: readonly ReadonlyInput<PdfIndexSource>[],
  paperIds: readonly string[],
): PdfTextPartition {
  const raw = rawPartitionPdfTexts(stored, paperIds) as {
    kept: number[];
    pageCounts: Record<string, number>;
    orphanPaperIds: string[];
  };
  return {
    kept: raw.kept,
    pageCounts: new Map(Object.entries(raw.pageCounts)),
    orphanPaperIds: raw.orphanPaperIds,
  };
}
