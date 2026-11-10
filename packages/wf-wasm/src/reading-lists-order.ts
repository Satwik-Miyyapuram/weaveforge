/**
 * Reading-list tree order and subtree grouping (Rust `reading_lists::{list_order,
 * subtree_items}`). The fetch of a subtree's items stays in the web adapter.
 */
import {
  collectListIds as rawCollectListIds,
  reorderedIds as rawReorderedIds,
  movedIds as rawMovedIds,
  planItemOrder as rawPlanItemOrder,
  subtreeIds as rawSubtreeIds,
  groupSubtreeItems as rawGroupSubtreeItems,
} from "../pkg/wf_wasm.js";
import type { ItemOrderPlan, ItemOrderWrite, ReadingListItem, ReadingListTreeNode, SubtreeListItems } from "./bindings.js";

export type { ItemOrderPlan, ItemOrderWrite, SubtreeListItems } from "./bindings.js";

/** Every list id in the tree, parents before children, in tree order. */
export function collectListIds(tree: readonly ReadingListTreeNode[]): string[] {
  return rawCollectListIds(tree) as string[];
}

/** `ids` with `dragId` moved into `targetId`'s place, or null when nothing moves. */
export function reorderedIds(ids: readonly string[], dragId: string, targetId: string): string[] | null {
  return (rawReorderedIds(ids, dragId, targetId) as string[] | undefined) ?? null;
}

/** `ids` with `id` moved one step up (-1) or down (1), or null at either end. */
export function movedIds(ids: readonly string[], id: string, step: -1 | 1): string[] | null {
  return (rawMovedIds(ids, id, step) as string[] | undefined) ?? null;
}

/** The writes that give `items` (one list's rows) the order `orderedIds`. The caller checks `listId`. */
export function planItemOrder(
  listId: string,
  items: readonly ReadingListItem[],
  orderedIds: readonly string[],
): ItemOrderPlan {
  return rawPlanItemOrder(listId, items, [...orderedIds]) as ItemOrderPlan;
}

/** The id of `node` and of every list below it, parents before children. */
export function subtreeIds(node: ReadingListTreeNode): string[] {
  return rawSubtreeIds(node) as string[];
}

/** The subtree's items grouped by list: every list in the subtree, in subtree order. */
export function groupSubtreeItems(
  node: ReadingListTreeNode,
  items: readonly ReadingListItem[],
): SubtreeListItems[] {
  return rawGroupSubtreeItems(node, items) as SubtreeListItems[];
}
