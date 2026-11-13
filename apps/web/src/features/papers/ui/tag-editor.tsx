"use client";

import { useState, type RefObject } from "react";
import { type Paper } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { TagChips } from "@/components/tag-chips";
import { reconcileTagsFromBodyOrDefer } from "../lib/note-tags";
import { bodyWithoutTag, type LiveText } from "./tag-editor-body";

/**
 * Tags for a paper. Tags are parsed from the note body's #hashtags — there is
 * no manual add here; deleting a chip removes that hashtag from the body,
 * and from the open `editor` too when there is one.
 */
export function TagEditor({ paper, onReplace, editor }: { paper: Paper; onReplace: (p: Paper) => void; editor?: RefObject<LiveText | null> }) {
  const [busy, setBusy] = useState(false);

  async function removeTag(tag: string) {
    setBusy(true);
    try {
      const papers = getContainer().papers;
      const body = bodyWithoutTag(tag, editor?.current, paper.summary ?? "");
      const saved = await papers.updatePaper.setSummary(paper.id, body);
      onReplace((await reconcileTagsFromBodyOrDefer(papers, paper.id, body)) ?? saved);
    } finally {
      setBusy(false);
    }
  }

  return <TagChips tags={paper.tags} busy={busy} onRemove={(t) => void removeTag(t)} />;
}
