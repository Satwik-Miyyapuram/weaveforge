"use client";

import { useCallback, useEffect, useState } from "react";
import type { ShareableType } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { BookmarkIcon } from "@/components/view-icons";

export function AddToLibraryButton({
  resourceType,
  resourceId,
  ownerId,
  onPinned,
}: {
  resourceType: ShareableType;
  resourceId: string;
  ownerId: string;
  onPinned?: () => void;
}) {
  const [pinned, setPinned] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setPinned(
        await getContainer().sharing.isPinned(resourceType, resourceId),
      );
    } catch {
      setPinned(false);
    }
  }, [resourceType, resourceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function pin() {
    setBusy(true);
    setMsg(null);
    try {
      await getContainer().sharing.pinShared({
        resourceType,
        resourceId,
        ownerId,
      });
      setPinned(true);
      setMsg("Added to your library");
      onPinned?.();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function unpin() {
    setBusy(true);
    setMsg(null);
    try {
      await getContainer().sharing.unpinShared(resourceType, resourceId);
      setPinned(false);
      setMsg("Removed from library");
      onPinned?.();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="shared-library-actions" onClick={(e) => e.stopPropagation()}>
      {pinned ? (
        <button
          type="button"
          className="btn-secondary entity-icon-text-btn"
          disabled={busy}
          onClick={() => void unpin()}
        >
          <BookmarkIcon />
          <span>In library</span>
        </button>
      ) : (
        <button
          type="button"
          className="btn-primary entity-icon-text-btn"
          disabled={busy}
          onClick={() => void pin()}
        >
          <BookmarkIcon />
          <span>Add to library</span>
        </button>
      )}
      {msg && <span className="muted shared-library-msg">{msg}</span>}
    </div>
  );
}
