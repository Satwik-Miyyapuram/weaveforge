"use client";

import { useState } from "react";
import { type VaultPage } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { InlineError } from "@/components/form-error";
import { TagChips } from "@/components/tag-chips";
import { runNoteAction } from "./run-note-action";
import { readyCore } from "@/lib/rust-core";
import { removeNoteTag } from "../../application/remove-note-tag";

export function NoteTagEditor({ page, onChanged }: { page: VaultPage; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tags = readyCore().extractHashtags(page.body);

  async function removeTag(tag: string) {
    await runNoteAction(setBusy, setError, async () => {
      await removeNoteTag(getContainer().vault.manageVaultPage, page, tag);
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
