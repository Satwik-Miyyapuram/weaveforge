"use client";

import { useId, useRef, useState } from "react";
import { CommentsIcon } from "@/components/view-icons";
import { useDismissOnOutside } from "@/lib/use-dismiss-on-outside";
import { CommentsPanel } from "./comments-panel";

/**
 * Comments trigger. Cards use the compact icon; detail pages use a labeled
 * control so the action isn't lost among tiny chrome icons.
 */
export function CommentsToggle({
  resourceType,
  resourceId,
  canComment,
  variant = "compact",
}: {
  resourceType: string;
  resourceId: string;
  canComment: boolean;
  variant?: "compact" | "detail";
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const detail = variant === "detail";
  const label = open ? "Hide comments" : "Comments";

  useDismissOnOutside(open, () => setOpen(false), wrapRef);

  return (
    <div className={`comments-toggle${detail ? " comments-toggle--detail" : ""}`} ref={wrapRef}>
      <button
        type="button"
        className={
          detail
            ? "btn-secondary entity-icon-text-btn comments-trigger-detail"
            : "entity-icon-btn"
        }
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={label}
        title={label}
      >
        <CommentsIcon size={detail ? 18 : 16} />
        {detail ? <span>{open ? "Hide comments" : "Comments"}</span> : null}
      </button>
      {open && (
        <div id={panelId} className="comments-sheet" role="region" aria-label="Comments">
          <CommentsPanel resourceType={resourceType} resourceId={resourceId} canComment={canComment} />
        </div>
      )}
    </div>
  );
}
