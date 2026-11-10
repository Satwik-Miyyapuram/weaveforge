/**
 * Paper counts per tag (Rust `tag_counts`). The app reads the links in chunks and
 * passes them in; this only counts.
 */
import { paperCountsForTags as rawPaperCountsForTags } from "../pkg/wf_wasm.js";
import type { TagPaperLink } from "./bindings.js";

export type { TagPaperLink } from "./bindings.js";

/** Distinct papers per tag id, in `tagIds` order. A tag with no links counts `0`. */
export function paperCountsForTags(tagIds: readonly string[], links: readonly TagPaperLink[]): number[] {
  return rawPaperCountsForTags(tagIds, links) as number[];
}
