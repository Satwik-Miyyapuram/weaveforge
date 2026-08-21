"use client";

import { useCallback } from "react";

/**
 * The two questions every screen that shows pinned, shared items asks.
 *
 * Experiments, milestones, reading lists and report sections all display a mix
 * of the reader's own rows and rows somebody else pinned to them, and all four
 * need the same two answers: may this row be edited, and whose is it. The four
 * copies were identical apart from the report's extra rule, which is now the
 * `canEdit` argument rather than a silent divergence.
 */
export interface PinnedSharing {
  /** True for a row this reader may look at but not change. */
  isReadOnly: (id: string) => boolean;
  /** The display name of whoever shared a row, or undefined for the reader's own. */
  sharedOwnerName: (id: string) => string | undefined;
}

export function usePinnedSharing({
  isSharedView,
  pinnedSharedBy,
  ownerNames,
  canEdit,
}: {
  /** The whole screen is somebody else's, opened through a share link. */
  isSharedView: boolean;
  /** Row id → the id of the person who shared it. */
  pinnedSharedBy: Map<string, string>;
  /** Person id → their display name. */
  ownerNames: Map<string, string>;
  /**
   * Rows a share explicitly grants write access to, which overrides the
   * read-only default. Only report sections are shared that way today; a screen
   * without collaborative editing leaves this out.
   */
  canEdit?: Map<string, boolean>;
}): PinnedSharing {
  const isReadOnly = useCallback(
    (id: string) => (isSharedView || pinnedSharedBy.has(id)) && !canEdit?.get(id),
    [isSharedView, pinnedSharedBy, canEdit],
  );

  const sharedOwnerName = useCallback(
    (id: string) => {
      const ownerId = pinnedSharedBy.get(id);
      return ownerId ? ownerNames.get(ownerId) : undefined;
    },
    [pinnedSharedBy, ownerNames],
  );

  return { isReadOnly, sharedOwnerName };
}
