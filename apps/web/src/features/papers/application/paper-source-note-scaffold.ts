/**
 * Light ZotFlow-style scaffold inserted when a paper note is first created.
 * Uses the Phase C1 default template engine so re-render can refresh metadata
 * without destroying researcher edits.
 */

import { resolveCiteKey, type Paper } from "@weaveforge/core";
import { isEmptyPaperSummary } from "@/lib/paper-summary";
import { applyTemplate } from "@/features/vault/application/note-template-engine";
import {
  DEFAULT_SOURCE_NOTE_TEMPLATE,
  sourceNoteTemplateContext,
} from "@/features/vault/application/default-source-note-template";

export function paperSourceNoteScaffold(input: {
  title: string;
  authors?: readonly string[];
  year?: number;
  venue?: string;
  doi?: string;
  citeKey?: string;
}): string {
  return applyTemplate(null, DEFAULT_SOURCE_NOTE_TEMPLATE, sourceNoteTemplateContext(input));
}

/** Explicit re-render — never call silently on load. */
export function reRenderPaperSourceNote(
  existing: string,
  input: {
    title: string;
    authors?: readonly string[];
    year?: number;
    venue?: string;
    doi?: string;
    citeKey?: string;
  },
): string {
  return applyTemplate(existing, DEFAULT_SOURCE_NOTE_TEMPLATE, sourceNoteTemplateContext(input));
}

/**
 * Give a just-added paper its note scaffold, unless it already has a note.
 * Returns the paper as saved, so whatever runs next (the Zotero push) sees
 * the scaffolded note rather than the empty one.
 */
export async function scaffoldNewPaperNote(
  paper: Paper,
  papers: { setSummary(id: string, summary: string): Promise<Paper> },
): Promise<Paper> {
  if (!isEmptyPaperSummary(paper.summary)) return paper;
  const scaffold = paperSourceNoteScaffold({
    title: paper.title,
    authors: paper.authors,
    year: paper.year,
    venue: paper.venue,
    doi: paper.doi,
    citeKey: resolveCiteKey(paper),
  });
  return papers.setSummary(paper.id, scaffold);
}
