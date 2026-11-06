"use client";

import { useSyncExternalStore } from "react";
import { Chip } from "@/components/controls";
import { autoIndexStatus, cancelLibraryIndex, subscribeAutoIndex } from "../application/auto-index-library";

/**
 * A PDF indexing run, shown in the nav while it goes, with × to stop it.
 *
 * A whole-library run can take an hour or more; its progress used to live only
 * in Settings, so leaving that screen hid it (rubric 7).
 */
export function PdfIndexChip() {
  const status = useSyncExternalStore(subscribeAutoIndex, autoIndexStatus, autoIndexStatus);
  if (!status.running || !status.progress) return null;
  const { done, total } = status.progress;
  return (
    <span className="sync-slot" role="status">
      <Chip
        title={status.progress.current ? `Reading ${status.progress.current}` : "Indexing PDFs"}
        onRemove={cancelLibraryIndex}
        removeLabel="Stop indexing"
      >
        <span className="sync-dot" />
        <span>
          Indexing PDFs {done} of {total}
        </span>
      </Chip>
    </span>
  );
}
