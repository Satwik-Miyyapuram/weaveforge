/**
 * Reading-list tree order and subtree grouping (Rust `reading_lists::{list_order,
 * subtree_items}`). The fetch of a subtree's items stays in the web adapter.
 */
import {
  reorderedIds as rawReorderedIds,
  movedIds as rawMovedIds,
  planItemOrder as rawPlanItemOrder,
  itemIdsForPapers as rawItemIdsForPapers,
  isInheritedLinkCode as rawIsInheritedLinkCode,
} from "../pkg/wf_wasm.js";
import type {
  ItemIdsPlan,
  ItemOrderPlan,
  ItemOrderWrite,
  ReadingListItem,
  SubtreeListItems,
} from "./bindings.js";

export {
  collectListIds,
  groupSubtreeItems,
  nextSortOrder,
} from "../pkg/wf_wasm.js";

export {
  subtreeIds,
} from "../pkg/wf_wasm.js";

export type { ItemIdsPlan, ItemOrderPlan, ItemOrderWrite, SubtreeListItems } from "./bindings.js";

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

/** The item id of each paper in `paperIds` order, or an error when a paper is not in the list. */
export function itemIdsForPapers(
  listId: string,
  items: readonly ReadingListItem[],
  paperIds: readonly string[],
): ItemIdsPlan {
  return rawItemIdsForPapers(listId, items, [...paperIds]) as ItemIdsPlan;
}

/** Whether a database error code means only the inherited link failed. */
export function isInheritedLinkCode(code: string | null | undefined): boolean {
  return rawIsInheritedLinkCode(code ?? undefined) as boolean;
}

