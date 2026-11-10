/**
 * Paper counts per tag (Rust `tag_counts`). The app reads the links in chunks and
 * passes them in; this only counts.
 */
import type {
  TagPaperLink,
} from "./bindings.js";

export {
  paperCountsForTags,
} from "../pkg/wf_wasm.js";

export type { TagPaperLink } from "./bindings.js";

