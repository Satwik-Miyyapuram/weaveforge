"use client";

import { useCallback, useEffect, useState } from "react";
import type { ReadingListItem, ReadingListTreeNode } from "@weaveforge/core";
import { loadSubtreeItems } from "@/features/reading-lists/application/parts";
import { formatError } from "@/lib/format-error";

/**
 * The items of the shown list's subtree, in one fetch (36-08). A failure is
 * kept here, for the items pane to show with a Retry, so the rail and the panes
 * stay up (P2-179). The next successful fetch clears it.
 */
export function useSubtreeItems(
  node: ReadingListTreeNode | null,
  refresh: number,
  fetchItems: (listIds: readonly string[]) => Promise<ReadingListItem[]>,
): { itemsByList: ReadonlyMap<string, ReadingListItem[]>; error: string | null; retry: () => void } {
  const [itemsByList, setItemsByList] = useState<ReadonlyMap<string, ReadingListItem[]>>(() => new Map());
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!node) return;
    let active = true;
    loadSubtreeItems(node, fetchItems)
      .then((byList) => {
        if (!active) return;
        setItemsByList(byList);
        setError(null);
      })
      .catch((err: unknown) => {
        if (active) setError(formatError(err));
      });
    return () => {
      active = false;
    };
  }, [node, refresh, attempt, fetchItems]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { itemsByList, error, retry };
}