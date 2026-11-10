/**
 * Image-region annotations for bulk extract (Rust
 * `reader::batch_annotation_ops`), re-exported from index.ts.
 */
import type {
  AnnotationInput,
} from "./bindings.js";

export {
  collectAnnotationImageRegions,
} from "../pkg/wf_wasm.js";

/** The fields of a reader annotation that the image-region rule reads (Rust `AnnotationInput`). */
export type { AnnotationInput as RegionAnnotation } from "./bindings.js";

