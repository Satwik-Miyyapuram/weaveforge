/**
 * Stored reader annotation row to domain annotation (Rust `reader::annotation_rows`), re-exported
 * from index.ts.
 */
import { annotationRowToDomain as rawAnnotationRowToDomain } from "../pkg/wf_wasm.js";
import type { ReaderAnnotation, ReaderAnnotationRow } from "./bindings.js";

/**
 * The row as a `ReaderAnnotation`.
 *
 * @throws `Error` (`Invalid annotation type in store: <type>`) when the row's type is unknown.
 */
export function annotationRowToDomain(row: ReaderAnnotationRow): ReaderAnnotation {
  return rawAnnotationRowToDomain(row) as ReaderAnnotation;
}
