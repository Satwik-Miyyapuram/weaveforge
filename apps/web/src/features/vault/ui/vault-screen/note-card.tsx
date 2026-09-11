"use client";

import { useMemo, useState } from "react";
import { extractHashtags, type VaultPage, type VaultPageSummary } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { EntityCard } from "@/components/entity-card";
import { ShareButton, PinnedPaperBadge } from "@/features/sharing";
import { cardSnippet } from "@/lib/card-snippet";
import { isHydratedPage, noteBodyText } from "@/lib/page-text";

/**
 * Re-exported so the screens and panels that already imported them from here do
 * not have to change. The definitions moved to `@/lib/page-text` because a
 * second feature (the editor workspace) needs the same two functions, and a
 * shared helper under `features/vault/ui/` would make that import a
 * cross-feature `ui/` import.
 */
export { isHydratedPage, noteBodyText };

/** Papers-style card for a note: title + excerpt; click opens the full note. */
export function NoteCard({
  page,
  readOnly = false,
  sharedByName,
  onOpen,
  onChanged,
}: {
  page: VaultPageSummary | VaultPage;
  readOnly?: boolean;
  sharedByName?: string;
  onOpen: () => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const preview = noteBodyText(page);
  const excerpt = cardSnippet(preview);
  const tags = useMemo(() => extractHashtags(preview), [preview]);

  async function remove() {
    if (!confirm(`Delete “${page.title}”?`)) return;
    setBusy(true);
    try {
      await getContainer().vault.manageVaultPage.remove(page.id);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <EntityCard
      className="paper-card"
      onActivate={onOpen}
      title={page.title}
      status={readOnly ? <PinnedPaperBadge ownerName={sharedByName} /> : undefined}
      tags={tags}
      onDelete={readOnly ? undefined : () => void remove()}
      deleteDisabled={busy}
      deleteAriaLabel="Delete note"
      actions={
        !readOnly ? (
          <ShareButton resourceType="vault_page" resourceId={page.id} title={`Share: ${page.title}`} />
        ) : undefined
      }
      onOpen={onOpen}
      openLabel="Open note"
    >
      {excerpt ? <p className="entity-card-snippet">{excerpt}</p> : null}
    </EntityCard>
  );
}
