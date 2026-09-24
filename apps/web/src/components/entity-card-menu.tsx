"use client";

import { useState } from "react";
import type { ShareableType } from "@weaveforge/core";
import { CardMenu, type CardMenuItem } from "./card-menu";
import { ShareButton } from "@/features/sharing";

/**
 * The overflow menu on every entity card.
 *
 * One component, so the foot of a card is the same shape everywhere: the status
 * stays on the card, Share and Delete live behind one ⋯, and the card body is
 * the way in. Each screen used to wire its own `ShareButton` and delete handler,
 * which is exactly how papers and notes ended up with a kebab while
 * experiments, milestones and report sections kept three inline controls each.
 *
 * The share sheet is mounted here, beside the menu, because `CardMenu` closes
 * the moment an item is picked — a dialog owned by the menu would go with it.
 */
export function EntityCardMenu({
  resourceType,
  resourceId,
  title,
  onDelete,
  deleteLabel = "Delete",
  deleteDisabled = false,
  extraItems = [],
  shareable = true,
}: {
  /** Absent on a card whose entity has no share type yet, like a log entry. */
  resourceType?: ShareableType;
  resourceId?: string;
  title?: string;
  /** Absent for a read-only card, or one the reader may not delete. */
  onDelete?: () => void;
  deleteLabel?: string;
  deleteDisabled?: boolean;
  /** Items between Share and Delete — "Add to list" for papers and notes. */
  extraItems?: CardMenuItem[];
  /**
   * False for an entity with no share type — a log entry today. The menu still
   * carries Edit and Delete; Share joins it when the type exists.
   */
  shareable?: boolean;
}) {
  const [shareOpen, setShareOpen] = useState(false);
  const canShare = shareable && !!resourceType && !!resourceId;
  const items: CardMenuItem[] = [
    ...(canShare ? [{ id: "share", label: "Share", onSelect: () => setShareOpen(true) }] : []),
    ...extraItems,
  ];
  if (onDelete) {
    items.push({
      id: "delete",
      label: deleteLabel,
      danger: true,
      disabled: deleteDisabled,
      onSelect: onDelete,
    });
  }
  return (
    <>
      <CardMenu items={items} />
      {canShare && (
        <ShareButton
          hideTrigger
          resourceType={resourceType!}
          resourceId={resourceId!}
          title={title ?? ""}
          open={shareOpen}
          onOpenChange={setShareOpen}
        />
      )}
    </>
  );
}
