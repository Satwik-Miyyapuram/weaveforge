/**
 * Annotation backlinks (Rust `reader::annotation_backlinks`), re-exported from
 * index.ts. The hit and target types come from ./bindings.ts.
 */
import {
  findAnnotationBacklinks as rawFindAnnotationBacklinks,
  backlinksForAnnotation as rawBacklinksForAnnotation,
} from "../pkg/wf_wasm.js";
import type { AnnotationBacklinkHit, AnnotationBacklinkTarget } from "./bindings.js";

export type { AnnotationBacklinkHit, AnnotationBacklinkTarget } from "./bindings.js";

/**
 * Reverse links from annotations to report sections (via pins) and vault pages
 * (via body text containing the key or a quote of 12+ UTF-16 units).
 */
export function findAnnotationBacklinks(input: {
  annotations: readonly { id: string; zoteroKey?: string | null; text: string }[];
  pins: readonly { annotationKey: string; reportSectionId: string }[];
  sections: readonly { id: string; title: string }[];
  vaultPages: readonly { id: string; title: string; body?: string | null }[];
}): AnnotationBacklinkHit[] {
  return rawFindAnnotationBacklinks(input) as AnnotationBacklinkHit[];
}

/** The targets of the first hit for an annotation, or none (Rust `backlinks_for_annotation`). */
export function backlinksForAnnotation(
  hits: readonly AnnotationBacklinkHit[],
  annotationId: string,
): AnnotationBacklinkTarget[] {
  return rawBacklinksForAnnotation(hits, annotationId) as AnnotationBacklinkTarget[];
}
