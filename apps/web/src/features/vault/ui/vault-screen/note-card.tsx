"use client";

import { useMemo, useState } from "react";
import { extractHashtags, type VaultPage, type VaultPageSummary } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { EntityCard } from "@/components/entity-card";
import { CardMenu } from "@/components/card-menu";
import { ShareButton, PinnedPaperBadge } from "@/features/sharing";
import { ListPicker } from "@/features/reading-lists";
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

/** "Edited 22 Sep"; the year only when it is not this one. */
function editedLabel(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return `Edited ${d.toLocaleDateString(undefined, { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) })}`;
}

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
  // Held here rather than inside the menu: the menu closes the moment an item is
  // picked, and the dialog it opened has to outlive that.
  const [shareOpen, setShareOpen] = useState(false);
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
    <>
      <EntityCard
        className="paper-card"
        onActivate={onOpen}
        title={page.title}
        meta={editedLabel(page.updatedAt)}
        status={readOnly ? <PinnedPaperBadge ownerName={sharedByName} /> : undefined}
        tags={tags}
        // One overflow menu instead of a delete icon and a share button on every
        // card in the grid; the body of the card opens the note.
        menu={
          readOnly ? undefined : (
            <CardMenu
              items={[
                { id: "share", label: "Share", onSelect: () => setShareOpen(true) },
                { id: "list", label: "Add to list", onSelect: () => {}, submenu: () => <ListPicker target={{ kind: "note", id: page.id }} /> },
                { id: "delete", label: "Delete", danger: true, disabled: busy, onSelect: () => void remove() },
              ]}
            />
          )
        }
      >
        {excerpt ? <p className="entity-card-snippet">{excerpt}</p> : null}
      </EntityCard>
      {/* Both dialogs live above the card so a list refresh that remounts it
          cannot close them mid-decision. */}
      <ShareButton
        hideTrigger
        resourceType="vault_page"
        resourceId={page.id}
        title={`Share: ${page.title}`}
        open={shareOpen}
        onOpenChange={setShareOpen}
      />
    </>
  );
}
