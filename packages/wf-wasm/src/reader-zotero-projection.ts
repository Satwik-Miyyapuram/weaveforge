/**
 * Zotero annotation projection (Rust `reader::zotero_projection`), re-exported from index.ts.
 * Keeps the signature of apps/web reader/application/project-zotero-annotations.ts.
 */
import { projectZoteroAnnotations as rawProjectZoteroAnnotations } from "../pkg/wf_wasm.js";
import type { ZoteroAnnotationInput, ZoteroReaderAnnotation } from "./bindings.js";

/** Cached Zotero annotations as reader annotations; notes are dropped, the rest sorted by position. */
export function projectZoteroAnnotations(
  annotations: readonly ZoteroAnnotationInput[],
  options?: { contentHash?: string; now?: string },
): ZoteroReaderAnnotation[] {
  return rawProjectZoteroAnnotations(
    [...annotations],
    options?.contentHash?.trim() || undefined,
    options?.now,
  ) as ZoteroReaderAnnotation[];
}
