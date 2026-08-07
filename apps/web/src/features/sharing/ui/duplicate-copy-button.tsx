"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ShareableType } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { DuplicateIcon } from "@/components/view-icons";

const COPYABLE: ReadonlySet<ShareableType> = new Set(["paper", "vault_page"]);

export function DuplicateCopyButton({
  resourceType,
  resourceId,
  ownerId,
  onCopied,
}: {
  resourceType: ShareableType;
  resourceId: string;
  ownerId: string;
  onCopied?: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  if (!COPYABLE.has(resourceType)) return null;

  async function copy() {
    setBusy(true);
    setMsg(null);
    try {
      if (resourceType === "paper") {
        const paper = await getContainer().sharing.duplicateSharedPaper({
          resourceId,
          ownerId,
        });
        setMsg("Copied to your papers");
        onCopied?.();
        router.push(`/papers?paper=${encodeURIComponent(paper.id)}`);
        return;
      }
      const page = await getContainer().vault.duplicateSharedPage({
        resourceId,
        ownerId,
      });
      setMsg("Copied to your vault");
      onCopied?.();
      router.push(`/notes?page=${encodeURIComponent(page.id)}`);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="shared-library-actions" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className="btn-secondary entity-icon-text-btn"
        disabled={busy}
        onClick={() => void copy()}
        aria-label="Make a copy"
      >
        <DuplicateIcon />
        <span>{busy ? "Copying…" : "Make a copy"}</span>
      </button>
      {msg && <span className="muted shared-library-msg">{msg}</span>}
    </div>
  );
}
