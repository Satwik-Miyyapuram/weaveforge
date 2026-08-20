"use client";

import { useState } from "react";
import { type Paper } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { TagChips } from "@/components/tag-chips";
import { removeHashtagFromBody, reconcileTagsFromBody } from "../lib/note-tags";

/**
 * Tags for a paper. Tags are parsed from the note body's #hashtags — there is
 * no manual add here; deleting a chip removes that hashtag from the body.
 */
export function TagEditor({ paper, onReplace }: { paper: Paper; onReplace: (p: Paper) => void }) {
  const [busy, setBusy] = useState(false);

  async function removeTag(tag: string) {
    setBusy(true);
    try {
      const papers = getContainer().papers;
      const body = removeHashtagFromBody(paper.summary ?? "", tag);
      await papers.updatePaper.setSummary(paper.id, body);
      onReplace(await reconcileTagsFromBody(papers.manageTags, paper.id, body));
    } finally {
      setBusy(false);
    }
  }

  return <TagChips tags={paper.tags} busy={busy} onRemove={(t) => void removeTag(t)} />;
}
