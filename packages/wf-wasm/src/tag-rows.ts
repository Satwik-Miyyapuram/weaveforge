/**
 * Tag and paper-tag row mapping (Rust `tag_row`). The column lists stay in the web app,
 * next to the queries that select them.
 */
import type { PaperTag, Tag } from "@weaveforge/core";
import {
  paperTagFromRow as rawPaperTagFromRow,
  tagFromRow as rawTagFromRow,
} from "../pkg/wf_wasm.js";
import type { PaperTagRowInput, TagRowInput } from "./bindings.js";

export type { PaperTagRowInput, TagRowInput } from "./bindings.js";

/** A `tags` row as the app's tag. A null colour becomes an absent colour. */
export function tagFromRow(row: TagRowInput): Tag {
  return rawTagFromRow(row) as Tag;
}

/** A `paper_tags` row as the app's paper-tag link. A null annotation becomes absent. */
export function paperTagFromRow(row: PaperTagRowInput): PaperTag {
  return rawPaperTagFromRow(row) as PaperTag;
}
