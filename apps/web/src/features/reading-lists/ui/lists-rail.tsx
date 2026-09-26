"use client";

import type { CSSProperties } from "react";
import type { ReadingList, ReadingListTreeNode } from "@weaveforge/core";
import { listDisplayColor } from "./list-ui";

/** One rail row: a list at its depth in the tree. */
interface RailRow {
  list: ReadingList;
  depth: number;
  sublists: number;
}

function flattenTree(nodes: readonly ReadingListTreeNode[], depth = 0): RailRow[] {
  return nodes.flatMap((n) => [
    { list: n.list, depth, sublists: n.children.length },
    ...flattenTree(n.children, depth + 1),
  ]);
}

/** Finds a list's node anywhere in the tree. */
export function findListNode(
  nodes: readonly ReadingListTreeNode[],
  id: string,
): ReadingListTreeNode | null {
  for (const n of nodes) {
    if (n.list.id === id) return n;
    const hit = findListNode(n.children, id);
    if (hit) return hit;
  }
  return null;
}

/**
 * The left rail of the two-pane Lists screen: every list, nested by depth,
 * then the lists shared with this project. Picking one shows it on the right.
 */
export function ListsRail({
  tree,
  pinned,
  selectedId,
  onSelect,
}: {
  tree: readonly ReadingListTreeNode[];
  pinned: readonly ReadingList[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const rows = flattenTree(tree);
  const row = (r: RailRow) => (
    <button
      key={r.list.id}
      type="button"
      className="lists-rail-item"
      aria-current={r.list.id === selectedId ? "true" : undefined}
      style={{ "--depth": r.depth } as CSSProperties}
      onClick={() => onSelect(r.list.id)}
    >
      <span className="list-color-dot" style={{ background: listDisplayColor(r.list) }} aria-hidden />
      <span className="lists-rail-name">{r.list.name}</span>
      {r.sublists > 0 && (
        <span className="lists-rail-count" title={`${r.sublists} sublist${r.sublists === 1 ? "" : "s"}`}>
          {r.sublists}
        </span>
      )}
    </button>
  );
  return (
    <nav className="card lists-rail" aria-label="Lists">
      {rows.map(row)}
      {pinned.length > 0 && (
        <>
          <span className="lists-rail-label">Shared with you</span>
          {pinned.map((list) => row({ list, depth: 0, sublists: 0 }))}
        </>
      )}
    </nav>
  );
}
