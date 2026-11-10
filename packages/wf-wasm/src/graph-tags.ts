/**
 * Graph tag helpers (Rust `graph_tags`), re-exported from index.ts.
 * Keeps the signatures of apps/web/src/features/relations/application/graph-tags.ts.
 * Rust reads only `tags`, `title`, `body` and `name`; extra fields are ignored.
 */
import type {
  NamedList,
  TaggedNote,
  TaggedPaper,
} from "./bindings.js";

export {
  graphTagNames,
  notesTagged,
  relatedConcepts,
} from "../pkg/wf_wasm.js";

/** The fields the graph tags read from a paper, note and list (generated types). */
export type {
  NamedList as GraphNamedList,
  TaggedNote as GraphTaggedNote,
  TaggedPaper as GraphTaggedPaper,
} from "./bindings.js";

