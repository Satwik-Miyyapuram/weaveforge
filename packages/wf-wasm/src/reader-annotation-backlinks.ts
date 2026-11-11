/**
 * Annotation backlinks (Rust `reader::annotation_backlinks`), re-exported from
 * index.ts. The hit and target types come from ./bindings.ts.
 */
export {
  backlinksForAnnotation,
  findAnnotationBacklinks,
} from "../pkg/wf_wasm.js";

export type { AnnotationBacklinkHit, AnnotationBacklinkTarget } from "./bindings.js";

