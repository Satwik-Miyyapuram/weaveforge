"use client";

import { useMemo, useState } from "react";
import { extractHashtags, type VaultPage, type VaultPageSummary } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { deletedMessage, removeLater, useHiddenKeys } from "@/lib/toast";
import { noteKey } from "./note-key";
import { InlineError } from "@/components/form-error";
import { EntityCard } from "@/components/entity-card";
import { EntityCardMenu } from "@/components/entity-card-menu";
import { PinnedPaperBadge } from "@/features/sharing";
import { ListPicker } from "@/features/reading-lists";
import { cardSnippet } from "@/lib/card-snippet";
import { isHydratedPage, noteBodyText, readableText } from "@/lib/page-text";
import { runNoteAction } from "./run-note-action";

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
  /** Why the last pin failed, shown on the card. */
  const [error, setError] = useState<string | null>(null);
  const hidden = useHiddenKeys().has(noteKey(page.id));
  const preview = noteBodyText(page);
  const excerpt = cardSnippet(readableText(preview));
  const tags = useMemo(() => extractHashtags(preview), [preview]);

  async function togglePin() {
    await runNoteAction(setBusy, setError, async () => {
      await getContainer().vault.manageVaultPage.update(page.id, { pinned: !page.pinned });
      onChanged();
    });
  }

  // Rule D-07: the card goes at once; the delete runs when the Undo toast closes.
  function remove() {
    removeLater({
      key: noteKey(page.id),
      message: deletedMessage(page.title, "Note"),
      remove: () => getContainer().vault.manageVaultPage.remove(page.id),
      onDeleted: onChanged,
    });
  }

  function unpin() {
    removeLater({
      key: noteKey(page.id),
      message: `"${page.title}" removed from your library`,
      remove: () => getContainer().sharing.unpinShared("vault_page", page.id),
      onDeleted: onChanged,
    });
  }

  if (hidden) return null;

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
              name={page.title}
              deleteDisabled={busy}
              deleteLabel={isPinned ? "Remove from library" : "Delete note"}
              onDelete={isPinned ? unpin : remove}
              extraItems={[
                ...(readOnly ? [] : [{ id: "pin", label: page.pinned ? "Unpin" : "Pin", disabled: busy, onSelect: () => void togglePin() }]),
                { id: "list", label: "Add to list", onSelect: () => {}, submenu: () => <ListPicker target={{ kind: "note", id: page.id }} /> },
              ]}
            />
          )
        }
      >
        {excerpt ? <p className="entity-card-snippet">{excerpt}</p> : null}
        {error && <InlineError>{error}</InlineError>}
      </EntityCard>
    </>
  );
}
