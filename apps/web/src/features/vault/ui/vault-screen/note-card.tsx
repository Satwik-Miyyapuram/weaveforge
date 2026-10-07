"use client";

import { useMemo, useState } from "react";
import { extractHashtags, type VaultPage, type VaultPageSummary } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EntityCard } from "@/components/entity-card";
import { EntityCardMenu } from "@/components/entity-card-menu";
import { PinnedPaperBadge } from "@/features/sharing";
import { ListPicker } from "@/features/reading-lists";
import { cardSnippet } from "@/lib/card-snippet";
import { isHydratedPage, noteBodyText, readableText } from "@/lib/page-text";

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
  isPinned = false,
  sharedByName,
  onOpen,
  onChanged,
}: {
  page: VaultPageSummary | VaultPage;
  readOnly?: boolean;
  isPinned?: boolean;
  sharedByName?: string;
  onOpen: () => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  /** Whether the delete confirmation is up. */
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmUnpinOpen, setConfirmUnpinOpen] = useState(false);
  const preview = noteBodyText(page);
  const excerpt = cardSnippet(readableText(preview));
  const tags = useMemo(() => extractHashtags(preview), [preview]);

  async function togglePin() {
    setBusy(true);
    try {
      await getContainer().vault.manageVaultPage.update(page.id, { pinned: !page.pinned });
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  /** The menu item only asks; the app's own dialog is what deletes. */
  async function remove() {
    setConfirmOpen(false);
    setBusy(true);
    try {
      await getContainer().vault.manageVaultPage.remove(page.id);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function unpin() {
    setConfirmUnpinOpen(false);
    setBusy(true);
    try {
      await getContainer().sharing.unpinShared("vault_page", page.id);
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
        badge={readOnly ? <PinnedPaperBadge ownerName={sharedByName} /> : undefined}
        tags={tags}
        tintTag={tags[0]}
        // One overflow menu instead of a delete icon and a share button on every
        // card in the grid; the body of the card opens the note.
        menu={
          readOnly && !isPinned ? undefined : (
            <EntityCardMenu
              resourceType="vault_page"
              resourceId={page.id}
              title={`Share: ${page.title}`}
              deleteDisabled={busy}
              deleteLabel={isPinned ? "Remove from library" : "Delete note"}
              onDelete={isPinned ? () => setConfirmUnpinOpen(true) : () => setConfirmOpen(true)}
              extraItems={[
                ...(readOnly ? [] : [{ id: "pin", label: page.pinned ? "Unpin" : "Pin", disabled: busy, onSelect: () => void togglePin() }]),
                { id: "list", label: "Add to list", onSelect: () => {}, submenu: () => <ListPicker target={{ kind: "note", id: page.id }} /> },
              ]}
            />
          )
        }
      >
        {excerpt ? <p className="entity-card-snippet">{excerpt}</p> : null}
      </EntityCard>

      {confirmOpen && (
        <ConfirmDialog
          title="Delete this note?"
          body={`“${page.title}” goes away, and so do the links that point at it. Its text is not kept.`}
          confirmLabel="Delete note"
          danger
          busy={busy}
          onConfirm={() => void remove()}
          onClose={() => setConfirmOpen(false)}
        />
      )}

      {confirmUnpinOpen && (
        <ConfirmDialog
          title="Remove shared note?"
          body={`“${page.title}” will be removed from your workspace. The original will stay intact for ${sharedByName ?? "its owner"}.`}
          confirmLabel="Remove from library"
          danger
          busy={busy}
          onConfirm={() => void unpin()}
          onClose={() => setConfirmUnpinOpen(false)}
        />
      )}
    </>
  );
}
