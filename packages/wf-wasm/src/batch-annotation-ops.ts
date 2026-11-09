/**
 * Image-region annotations for bulk extract (Rust
 * `reader::batch_annotation_ops`), re-exported from index.ts.
 */
import { collectAnnotationImageRegions as rawCollectAnnotationImageRegions } from "../pkg/wf_wasm.js";
import type { AnnotationInput, BatchImageRegion } from "./bindings.js";

/** The fields of a reader annotation that the image-region rule reads (Rust `AnnotationInput`). */
export type { AnnotationInput as RegionAnnotation } from "./bindings.js";

/** One rect per image-annotation rect, with its page and colour. */
export function collectAnnotationImageRegions(annotations: readonly AnnotationInput[]): BatchImageRegion[] {
  return rawCollectAnnotationImageRegions(annotations) as BatchImageRegion[];
}
