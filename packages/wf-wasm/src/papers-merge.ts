/**
 * Merging a duplicate paper into the copy kept (Rust `papers::paper_merge`). Re-exported
 * from index.ts. The type is generated from Rust into bindings.ts.
 */
import { mergePaperInto as rawMergePaperInto } from "../pkg/wf_wasm.js";
import type { MergePaper } from "./bindings.js";

export type { MergePaper } from "./bindings.js";

/**
 * The kept paper with what the duplicate knew and it did not. Nothing the kept copy has is
 * overwritten: gaps are filled, tags and metadata are unioned, and `mergedFrom` records the
 * duplicate's id.
 */
export function mergePaperInto(keep: MergePaper, dup: MergePaper): MergePaper {
  return rawMergePaperInto(keep, dup) as MergePaper;
}
