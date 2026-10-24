import type { ReadingListItem, ReadingListTreeNode } from "@weaveforge/core";

function subtreeIds(node: ReadingListTreeNode): string[] {
  return [node.list.id, ...node.children.flatMap(subtreeIds)];
}

/**
 * Items for every list in a subtree, from one fetch, grouped by list (36-08).
 * Every list in the subtree gets an entry, empty when it holds nothing; the
 * fetch order is kept within each list.
 */
export async function loadSubtreeItems(
  node: ReadingListTreeNode,
  fetchItems: (listIds: readonly string[]) => Promise<ReadingListItem[]>,
): Promise<Map<string, ReadingListItem[]>> {
  const ids = subtreeIds(node);
  const byList = new Map<string, ReadingListItem[]>(ids.map((id) => [id, []]));
  for (const item of await fetchItems(ids)) byList.get(item.listId)?.push(item);
  return byList;
}
