/**
 * Paper note appending (Rust `paper_note::append_paper_note`), re-exported from index.ts. Keeps
 * the result of packages/core/src/features/ai-assistant/domain/ai-write-proposal.ts.
 */
import { appendPaperNote as rawAppendPaperNote } from "../pkg/wf_wasm.js";

/** The note with `addition` after a blank line; `undefined` when the addition is blank. */
export function appendPaperNote(existing: string | undefined, addition: string): string | undefined {
  return rawAppendPaperNote(existing, addition) ?? undefined;
}
