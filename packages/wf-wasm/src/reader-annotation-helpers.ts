/**
 * Local annotation records (Rust `reader::annotation_helpers`), re-exported from
 * index.ts. The annotation, patch and draft types come from ./bindings.ts.
 */
import {
  annotationPinKey as rawAnnotationPinKey,
  applyAnnotationPatch as rawApplyAnnotationPatch,
  optimisticAnnotationFromDraft as rawOptimisticAnnotationFromDraft,
  listedAnnotations as rawListedAnnotations,
} from "../pkg/wf_wasm.js";
import type { NewReaderAnnotation, ReaderAnnotation } from "@weaveforge/core";
import type { AnnotationPatch } from "./bindings.js";

/** The Zotero key when present and non-blank, else the local id. */
export function annotationPinKey(id: string, zoteroKey?: string | null): string {
  return rawAnnotationPinKey(id, zoteroKey ?? undefined);
}

/** The full annotation after an edit. */
export function applyAnnotationPatch(ann: ReaderAnnotation, patch: AnnotationPatch): ReaderAnnotation {
  return rawApplyAnnotationPatch(ann, patch) as ReaderAnnotation;
}

/** The annotation to paint before its write returns. `now` is an ISO timestamp from the caller. */
export function optimisticAnnotationFromDraft(
  draft: NewReaderAnnotation,
  id: string,
  now: string,
): ReaderAnnotation {
  return rawOptimisticAnnotationFromDraft(draft, id, now) as ReaderAnnotation;
}

/** The marks the Annotations list shows (ink left out). */
export function listedAnnotations(annotations: readonly ReaderAnnotation[]): ReaderAnnotation[] {
  return rawListedAnnotations(annotations) as ReaderAnnotation[];
}
