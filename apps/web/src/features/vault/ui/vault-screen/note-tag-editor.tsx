"use client";

import { useState } from "react";
import { extractHashtags, type VaultPage } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { InlineError } from "@/components/form-error";
import { TagChips } from "@/components/tag-chips";
import { removeHashtagFromBody } from "@/features/papers/lib/note-tags";
import { runNoteAction } from "./run-note-action";

export function NoteTagEditor({ page, onChanged }: { page: VaultPage; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tags = extractHashtags(page.body);

  async function removeTag(tag: string) {
    await runNoteAction(setBusy, setError, async () => {
      const body = removeHashtagFromBody(page.body, tag);
      await getContainer().vault.manageVaultPage.update(page.id, { body });
      await onChanged();
    });
  }

  return (
    <>
      <TagChips tags={tags} busy={busy} onRemove={(t) => void removeTag(t)} />
      {error && <InlineError>{error}</InlineError>}
    </>
  );
}
