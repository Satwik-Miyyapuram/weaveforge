import type { Paper, PaperSummary } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { deferDelete, deletedMessage } from "@/lib/toast";

/** The two paper calls a delete needs. */
export interface PaperRemover {
  getPaper(id: string): Promise<Paper | null>;
  deletePaper(paper: Paper): Promise<unknown>;
}

/** The key screens hide while a paper's Undo toast shows. */
export const paperKey = (id: string) => `paper:${id}`;

/**
 * Delete a paper, from the card and from the note page alike (rule D-07): it
 * disappears at once, and the delete runs when the Undo toast closes.
 *
 * Takes the summary projection as well as a full paper, and re-reads the full
 * row before deleting. The delete needs the paper's `metadata` — the Zotero key
 * to remove the remote item, and the `paperimg:` paths to remove its figures —
 * and a card in a list only holds the summary, which has none of it. Deleting
 * from the projection therefore removed the row and left the images and the
 * Zotero item behind. Loading it here costs one read per delete, which is the
 * right place to pay it: a delete is a deliberate, single action, not something
 * a list render does per row.
 */
export function removePaper(
  paper: PaperSummary | Paper,
  { onHidden, onDeleted }: { onHidden?: () => void; onDeleted?: () => void },
  papers: PaperRemover = getContainer().papers,
): void {
  deferDelete({
    keys: [paperKey(paper.id)],
    message: deletedMessage(paper.title),
    commit: async () => {
      const full = "metadata" in paper ? paper : await papers.getPaper(paper.id);
      // `null` means the row is already gone, so there is nothing left to
      // delete — but the caller still has to be told, or the card stays.
      if (full) await papers.deletePaper(full);
      onDeleted?.();
    },
  });
  onHidden?.();
}
