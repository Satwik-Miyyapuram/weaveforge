"use client";

import { useEffect, useId, useRef, useState } from "react";
import { getContainer } from "@/bootstrap";
import { Button } from "@/components/button";
import { RowButton } from "@/components/controls";
import { CommentsIcon } from "@/components/view-icons";
import { useDismissOnOutside } from "@/lib/hooks/use-dismiss-on-outside";
import { CommentsBadge } from "./comments-badge";
import { NoteComments } from "./note-comments";

/**
 * Comments trigger. Cards use the compact icon; detail pages use a labeled
 * control so the action isn't lost among tiny chrome icons.
 */
export function CommentsToggle({
  resourceType,
  resourceId,
  canComment,
  isOwner = false,
  variant = "compact",
}: {
  resourceType: string;
  resourceId: string;
  canComment: boolean;
  /** May resolve anyone's thread. */
  isOwner?: boolean;
  variant?: "compact" | "detail";
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const detail = variant === "detail";
  const label = open ? "Hide comments" : "Comments";

  useDismissOnOutside(open, () => setOpen(false), wrapRef);

  // The open-thread count, on the detail toggle only: a list of cards would
  // ask the server once per card. Read again each time the sheet closes.
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!detail || open) return;
    let alive = true;
    getContainer().sharing.manageComments.list(resourceType, resourceId)
      .then((all) => alive && setCount(all.filter((c) => !c.parentId && !c.resolvedAt).length))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [detail, open, resourceType, resourceId]);

  const trigger = {
    onClick: () => setOpen((v) => !v),
    "aria-expanded": open,
    "aria-controls": open ? panelId : undefined,
    "aria-label": label,
    title: label,
  };
  return (
    <div className={`comments-toggle${detail ? " comments-toggle--detail" : ""}`} ref={wrapRef}>
      {detail ? (
        <Button className="entity-icon-text-btn comments-trigger-detail" {...trigger}>
          <CommentsIcon size={18} />
          <span>{open ? "Hide comments" : "Comments"}</span>
          <CommentsBadge count={count} />
        </Button>
      ) : (
        <RowButton className="entity-icon-btn" {...trigger}>
          <CommentsIcon size={16} />
          <CommentsBadge count={count} />
        </RowButton>
      )}
      {open && (
        <div id={panelId} className="comments-sheet" role="region" aria-label="Comments">
          <NoteComments embedded resourceType={resourceType} resourceId={resourceId} canComment={canComment} isOwner={isOwner} />
        </div>
      )}
    </div>
  );
}
