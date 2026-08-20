"use client";

import { useState } from "react";
import { type Paper } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
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

  if (paper.tags.length === 0) return null;
  return (
    <div className="tag-editor">
      <div className="tag-chips">
        {paper.tags.map((t) => (
          <span key={t} className="tag-chip editable">
            #{t}
            <button
              type="button"
              className="tag-del"
              aria-label={`Remove #${t}`}
              disabled={busy}
              onClick={() => void removeTag(t)}
            >
              ×
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}
