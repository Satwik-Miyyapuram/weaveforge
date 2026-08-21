"use client";

import { useState } from "react";
import { extractHashtags, type VaultPage } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { TagChips } from "@/components/tag-chips";
import { removeHashtagFromBody } from "@/features/papers/lib/note-tags";

export function NoteTagEditor({ page, onChanged }: { page: VaultPage; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const tags = extractHashtags(page.body);

  async function removeTag(tag: string) {
    setBusy(true);
    try {
      const body = removeHashtagFromBody(page.body, tag);
      await getContainer().vault.manageVaultPage.update(page.id, { body });
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  return <TagChips tags={tags} busy={busy} onRemove={(t) => void removeTag(t)} />;
}
