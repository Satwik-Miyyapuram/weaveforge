import type { ReadingList, ReadingListItem, ReadingListTreeNode } from "@weaveforge/core";
import { typedCore } from "@/lib/rust-core";

/** What the Rust mappers return: generated shapes, nullable where the domain type uses `?`. */
type WasmList = ReturnType<ReturnType<typeof typedCore>["readingListToDomain"]>;
type WasmItem = ReturnType<ReturnType<typeof typedCore>["readingListItemToDomain"]>;
type WasmTreeNode = ReturnType<ReturnType<typeof typedCore>["buildListTree"]>[number];

export function listFromWasm(list: WasmList): ReadingList {
  return {
    id: list.id,
    name: list.name,
    description: list.description ?? undefined,
    parentId: list.parentId ?? undefined,
    sortOrder: list.sortOrder ?? 0,
    color: list.color ?? undefined,
    createdAt: list.createdAt,
  };
}

export function itemFromWasm(item: WasmItem): ReadingListItem {
  return {
    id: item.id,
    listId: item.listId,
    paperId: item.paperId ?? undefined,
    vaultPageId: item.vaultPageId ?? undefined,
    sortOrder: item.sortOrder ?? 0,
    note: item.note ?? undefined,
    inheritedFromListId: item.inheritedFromListId ?? undefined,
    duplicateOfItemId: item.duplicateOfItemId ?? undefined,
  };
}

export function treeFromWasm(node: WasmTreeNode): ReadingListTreeNode {
  return { list: listFromWasm(node.list), children: node.children.map(treeFromWasm) };
}
