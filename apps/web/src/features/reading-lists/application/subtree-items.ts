import type { ReadingListItem, ReadingListTreeNode } from "@weaveforge/core";
import { readyCore } from "@/lib/rust-core";
import { itemFromWasm } from "./list-shapes";

/**
 * Items for every list in a subtree, from one fetch, grouped by list (36-08).
 * Every list in the subtree gets an entry, empty when it holds nothing; the
 * fetch order is kept within each list.
 */
export async function loadSubtreeItems(
  node: ReadingListTreeNode,
  fetchItems: (listIds: readonly string[]) => Promise<ReadingListItem[]>,
): Promise<Map<string, ReadingListItem[]>> {
  const core = readyCore();
  const items = await fetchItems(core.subtreeIds(node));
  return new Map(core.groupSubtreeItems(node, items).map((group): [string, ReadingListItem[]] => [group.listId, group.items.map(itemFromWasm)]));
}
