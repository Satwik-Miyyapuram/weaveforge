"use client";

import { useEffect } from "react";
import { loadPinnedOwnerNames } from "@/features/sharing/application/load-pinned-owner-names";

interface WithOwnerNames {
  /** resourceId -> sharer user id. */
  pinnedSharedBy: Map<string, string>;
  /** userId -> display name. Empty until the directory arrives. */
  ownerNames: Map<string, string>;
}

/**
 * Fill in "shared by" labels after the screen has already rendered.
 *
 * These names come from the lab directory, which reads `profiles` — measured at
 * ~1.8s against the live database while every other query on a screen load
 * finishes in about 220ms. Five screens used to `await` it before rendering
 * anything:
 *
 *     const data = await loadScreenData();              // ~220ms
 *     const ownerNames = await loadPinnedOwnerNames(…);  // ~1800ms
 *
 * The names are decoration on shared items; the papers, milestones, or lists
 * are the content. Blocking the content on the decoration made every one of
 * those screens feel eight times slower than it needed to.
 *
 * Screens now return `ownerNames: new Map()` and call this. Until it resolves,
 * a shared item shows its badge without a name — the same thing it shows for a
 * member who has since left the lab.
 */
export function usePinnedOwnerNames<T extends WithOwnerNames>(
  data: T | null,
  setData: (updater: (prev: T | null) => T | null) => void,
): void {
  const pinnedCount = data?.pinnedSharedBy.size ?? 0;
  const resolvedCount = data?.ownerNames.size ?? 0;

  useEffect(() => {
    // Nothing shared, or the names are already in hand (including from cache).
    if (pinnedCount === 0 || resolvedCount > 0) return;
    let active = true;
    void loadPinnedOwnerNames(data!.pinnedSharedBy)
      .then((names) => {
        if (!active || names.size === 0) return;
        setData((prev) => (prev ? { ...prev, ownerNames: names } : prev));
      })
      .catch(() => {
        /* labels are optional — a failure must not disturb the screen */
      });
    return () => {
      active = false;
    };
    // Keyed on the counts, not the object: `data` is replaced on every reload,
    // and depending on it would refetch the directory each time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinnedCount, resolvedCount, setData]);
}
