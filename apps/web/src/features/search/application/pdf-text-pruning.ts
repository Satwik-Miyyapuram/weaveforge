import type { PdfIndexSource, WorkspaceSnapshot } from "@weaveforge/core";
import { loadPdfTexts, removePdfTexts } from "../infrastructure/pdf-text-store";

/**
 * The PDF text worth indexing, and the text that has to go.
 *
 * Extracted text outlives the papers it came from: nothing deletes it when a
 * paper is removed, so the store slowly becomes a corpus of documents whose
 * reader would open nothing. Reading it back without pruning means search
 * answers with hits that cannot be opened — the failure is not an error, it is a
 * result that looks fine and goes nowhere.
 *
 * Pulled out of `WorkspaceSearch` because it is the one part of the build that
 * does I/O of its own, and it is worth reading on its own terms: it *returns*
 * what survives and *deletes* what does not, in that order, so a failed write
 * leaves the read still correct for this build.
 */
export interface PdfTextForIndex {
  /** Text whose paper still exists, in stored order. */
  texts: readonly PdfIndexSource[];
  /** Pages held per paper, so a re-extraction knows what to retract. */
  pageCounts: Map<string, number>;
  /** How many orphans were deleted, for the log and for tests. */
  removed: number;
}

export async function pruneMissingPaperTexts(
  projectId: string | null,
  snapshot: WorkspaceSnapshot,
): Promise<PdfTextForIndex> {
  const stored = await loadPdfTexts(projectId);
  const paperIds = new Set(snapshot.papers.map((paper) => paper.id));

  const texts = stored.filter((source) => paperIds.has(source.paperId));
  const pageCounts = new Map(texts.map((source) => [source.paperId, source.pages.length]));

  const orphans = stored.filter((source) => !paperIds.has(source.paperId));
  if (orphans.length) await removePdfTexts(projectId, orphans.map((source) => source.paperId));

  return { texts, pageCounts, removed: orphans.length };
}
