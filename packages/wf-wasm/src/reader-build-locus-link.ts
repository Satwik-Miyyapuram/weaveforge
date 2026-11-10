/**
 * Same-origin deep link into the reader (Rust `reader::build_locus_link`), re-exported from index.ts.
 */
import { buildLocusLink as rawBuildLocusLink } from "../pkg/wf_wasm.js";
import type { LocusLinkInput } from "./bindings.js";

/** `/reader?...` for the input, or `/reader` when no parameter is set. Absent fields may be `undefined`. */
export function buildLocusLink(input: Partial<LocusLinkInput>): string {
  return rawBuildLocusLink(input);
}
