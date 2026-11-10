/**
 * Annotation pin row to domain pin (Rust `papers::annotation_pin`), re-exported
 * from index.ts.
 */

import type {
  AnnotationPin,
  AnnotationPinRow,
} from "./bindings.js";

export {
  annotationPinToDomain,
} from "../pkg/wf_wasm.js";

export type { AnnotationPin, AnnotationPinRow };

