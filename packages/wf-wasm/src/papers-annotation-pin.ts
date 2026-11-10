/**
 * Annotation pin row to domain pin (Rust `papers::annotation_pin`), re-exported
 * from index.ts.
 */
import { annotationPinToDomain as rawAnnotationPinToDomain } from "../pkg/wf_wasm.js";

import type { AnnotationPin, AnnotationPinRow } from "./bindings.js";

export type { AnnotationPin, AnnotationPinRow };

/** Maps a stored annotation pin row to the domain pin. */
export function annotationPinToDomain(row: AnnotationPinRow): AnnotationPin {
  return rawAnnotationPinToDomain(row);
}
