/**
 * Merging a duplicate paper into the copy kept (Rust `papers::paper_merge`). Re-exported
 * from index.ts. The type is generated from Rust into bindings.ts.
 */
import {
  annotationIdentity as rawAnnotationIdentity,
  mergePaperInto as rawMergePaperInto,
  zoteroKeyOf as rawZoteroKeyOf,
} from "../pkg/wf_wasm.js";
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

/** The Zotero item key in a paper's metadata bag, or undefined when there is none. */
export function zoteroKeyOf(metadata: Record<string, unknown> | null | undefined): string | undefined {
  return (rawZoteroKeyOf(metadata ?? undefined) as string | null) ?? undefined;
}

/** The key two annotations share when they are the same mark (everything but id and paper). */
export function annotationIdentity(annotation: {
  type: string;
  color?: string | null;
  text?: string | null;
  comment?: string | null;
  anchor?: unknown;
}): string {
  return rawAnnotationIdentity(annotation);
}
