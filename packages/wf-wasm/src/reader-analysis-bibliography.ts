/**
 * Bibliography parsing (Rust `reader_analysis::bibliography`), re-exported from index.ts. Each function keeps
 * the signature and defaults of the TypeScript parser it replaced.
 * Object shapes come from ./bindings.ts.
 */
import {
  labelNumber as rawLabelNumber,
  parseBibliographyEntry as rawParseBibliographyEntry,
  parseBibliography as rawParseBibliography,
} from "../pkg/wf_wasm.js";
import type {
  AnalysisParsedReference,
  AnalysisTextLine,
} from "./bindings.js";

export {
  splitBibliographyEntries,
  splitByAuthorStart,
  splitByMargins,
  splitNumberedEntries,
} from "../pkg/wf_wasm.js";

export {
  extractVenue,
} from "../pkg/wf_wasm.js";

/** Entry number from the regex exec groups `[whole, g1..g5]`: the first set of `g2..g5`. */
export function labelNumber(groups: readonly (string | undefined)[]): number {
  return rawLabelNumber(groups);
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
