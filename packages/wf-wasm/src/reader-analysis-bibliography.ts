/**
 * Bibliography parsing (Rust `reader_analysis::bibliography`), re-exported from index.ts. Each function keeps
 * the signature and defaults of the TypeScript parser it replaced.
 * Object shapes come from ./bindings.ts.
 */
import { labelNumber as rawLabelNumber } from "../pkg/wf_wasm.js";

export {
  parseBibliography,
  parseBibliographyEntry,
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
