/**
 * Merging a duplicate paper into the copy kept (Rust `papers::paper_merge`). Re-exported
 * from index.ts. The type is generated from Rust into bindings.ts.
 */
import {
  zoteroKeyOf as rawZoteroKeyOf,
} from "../pkg/wf_wasm.js";
import type {
  MergePaper,
} from "./bindings.js";

export {
  annotationIdentity,
  mergePaperInto,
} from "../pkg/wf_wasm.js";

export type { MergePaper } from "./bindings.js";

/** The Zotero item key in a paper's metadata bag, or undefined when there is none. */
export function zoteroKeyOf(metadata: Record<string, unknown> | null | undefined): string | undefined {
  return (rawZoteroKeyOf(metadata ?? undefined) as string | null) ?? undefined;
}
