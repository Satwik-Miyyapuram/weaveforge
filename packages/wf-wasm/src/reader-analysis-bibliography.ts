/**
 * Bibliography parsing (Rust `reader_analysis::bibliography`), re-exported from index.ts. Each function keeps
 * the signature and defaults of packages/core/src/features/reader/analysis/bibliography-parser.ts.
 * Object shapes come from ./bindings.ts.
 */
import {
  labelNumber as rawLabelNumber,
  splitNumberedEntries as rawSplitNumberedEntries,
  splitByMargins as rawSplitByMargins,
  splitByAuthorStart as rawSplitByAuthorStart,
  splitBibliographyEntries as rawSplitBibliographyEntries,
  extractVenue as rawExtractVenue,
  parseBibliographyEntry as rawParseBibliographyEntry,
  parseBibliography as rawParseBibliography,
} from "../pkg/wf_wasm.js";
import type {
  AnalysisParsedReference,
  AnalysisTextLine,
} from "./bindings.js";

/** Entry number from the regex exec groups `[whole, g1..g5]`: the first set of `g2..g5`. */
export function labelNumber(groups: readonly (string | undefined)[]): number {
  return rawLabelNumber(groups);
}

/** Entries split by printed label, insisting on a monotonic sequence. */
export function splitNumberedEntries(lines: readonly AnalysisTextLine[]): AnalysisTextLine[][] {
  return rawSplitNumberedEntries(lines) as AnalysisTextLine[][];
}

/** Unnumbered entries where the left margin jumps back to its column minimum. */
export function splitByMargins(lines: readonly AnalysisTextLine[]): AnalysisTextLine[][] {
  return rawSplitByMargins(lines) as AnalysisTextLine[][];
}

/** Entries by the surname and initials (or "et al") that open each one. */
export function splitByAuthorStart(lines: readonly AnalysisTextLine[]): AnalysisTextLine[][] {
  return rawSplitByAuthorStart(lines) as AnalysisTextLine[][];
}

/** Splits by the first format that yields at least three entries. */
export function splitBibliographyEntries(lines: readonly AnalysisTextLine[]): AnalysisTextLine[][] {
  return rawSplitBibliographyEntries(lines) as AnalysisTextLine[][];
}

/** The venue named after a title, if one is printed; `undefined` otherwise. */
export function extractVenue(afterTitle: string): string | undefined {
  return rawExtractVenue(afterTitle);
}

/** Fields of one entry. Throws when `lines` is empty. */
export function parseBibliographyEntry(
  lines: readonly AnalysisTextLine[],
  index: number,
  withOffsets = true,
): AnalysisParsedReference {
  return rawParseBibliographyEntry(lines, index, withOffsets) as AnalysisParsedReference;
}

/** Every entry parsed, or an empty array when fewer than three entries split out. */
export function parseBibliography(
  lines: readonly AnalysisTextLine[],
  withOffsets = true,
): AnalysisParsedReference[] {
  return rawParseBibliography(lines, withOffsets) as AnalysisParsedReference[];
}
