/**
 * Reading-list tree helper (Rust `reading_lists::reading_list`), re-exported from index.ts.
 * Keeps the signature of packages/core/src/features/reading-lists/domain/reading-list.ts.
 */
import { buildListTree as rawBuildListTree } from "../pkg/wf_wasm.js";
import type { ReadingList, ReadingListTreeNode } from "./bindings.js";

export function buildListTree(lists: readonly ReadingList[]): ReadingListTreeNode[] {
  return rawBuildListTree(lists) as ReadingListTreeNode[];
}
