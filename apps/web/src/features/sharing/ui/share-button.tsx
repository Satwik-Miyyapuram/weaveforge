"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { ShareableType } from "@thesis/core";
import { getContainer } from "@/bootstrap";
import { ShareIcon } from "@/components/view-icons";
import { ShareDialog } from "./share-dialog";

/** Share trigger → ShareDialog. Icon-only by default; pass `showLabel` for text. */
export function ShareButton({
  resourceType,
  resourceId,
  title,
  label = "Share",
  showLabel = false,
  hideTrigger = false,
  open: openProp,
  onOpenChange,
}: {
  resourceType: ShareableType;
  resourceId: string | null;
  title: string;
  label?: string;
  showLabel?: boolean;
  hideTrigger?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const controlled = openProp !== undefined;
  const open = controlled ? Boolean(openProp) : uncontrolledOpen;

  useEffect(() => {
    setMounted(true);
  }, []);

  function setOpen(next: boolean) {
    if (!controlled) setUncontrolledOpen(next);
    onOpenChange?.(next);
  }
  const projectId = getContainer().projects.context.projectId;

  return (
    <>
      {!hideTrigger && (
        <button
          className={showLabel ? "btn-secondary entity-icon-text-btn" : "entity-icon-btn"}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(true);
          }}
          aria-label={label}
          title={label}
        >
          <ShareIcon />
          {showLabel ? <span>{label}</span> : null}
        </button>
      )}
      {mounted &&
        open &&
        createPortal(
          <ShareDialog
            resourceType={resourceType}
            resourceId={resourceId}
            projectId={projectId}
            title={title}
            onClose={() => setOpen(false)}
          />,
          document.body,
        )}
    </>
  );
}
