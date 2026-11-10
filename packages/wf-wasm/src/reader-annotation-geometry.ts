/**
 * Annotation geometry per page (Rust `reader::annotation_geometry`), re-exported
 * from index.ts. The input, bucket and geometry types come from ./bindings.ts.
 */
import {
  bucketAnnotationsByPage as rawBucketAnnotationsByPage,
} from "../pkg/wf_wasm.js";
import type { ReaderAnnotation } from "@weaveforge/core";
import type {
  PageBucket,
} from "./bindings.js";

export {
  projectPageAnnotationGeometry,
} from "../pkg/wf_wasm.js";

/**
 * Annotations grouped by 1-based page number, in first-insertion order. The raw
 * core returns index buckets; this rebuilds the Map the reader's callers expect.
 */
export function bucketAnnotationsByPage(
  annotations: readonly ReaderAnnotation[],
): Map<number, ReaderAnnotation[]> {
  const buckets = rawBucketAnnotationsByPage(annotations) as PageBucket[];
  const byPage = new Map<number, ReaderAnnotation[]>();
  for (const bucket of buckets) {
    byPage.set(
      bucket.pageNumber ?? 0,
      bucket.annotationIndices.map((i) => annotations[i] as ReaderAnnotation),
    );
  }
  return byPage;
}

