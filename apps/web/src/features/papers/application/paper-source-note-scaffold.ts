/**
 * Light ZotFlow-style scaffold inserted when a paper note is first created.
 * Uses the Phase C1 default template engine so re-render can refresh metadata
 * without destroying researcher edits.
 */

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
