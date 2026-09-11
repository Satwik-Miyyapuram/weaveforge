import type { Paper, PaperSummary } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";

/**
 * Delete a paper after confirming, from the card and from the note page alike.
 *
 * Both screens asked the same question, ran the same delete, and toggled the
 * same busy flag, so the wording of the warning could drift between them.
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
export async function confirmRemovePaper(
  paper: PaperSummary | Paper,
  setBusy: (busy: boolean) => void,
  onChanged: () => void,
): Promise<void> {
  if (!confirm(`Remove "${paper.title}"? This also deletes its list memberships and graph edges.`)) return;
  setBusy(true);
  try {
    const container = getContainer();
    // A full paper is already what the note page hands in; only the projection
    // needs the read. Inventing a full `Paper` from a summary to satisfy the
    // signature would mean making up an `abstract`, a `venue` and a `metadata`
    // bag, which is exactly the fabrication this review is removing.
    const full = "metadata" in paper ? paper : await container.papers.getPaper(paper.id);
    // `null` means the row is already gone, so there is nothing left to delete
    // — but the caller still has to be told, or the card stays on screen.
    if (full) await container.papers.deletePaper(full);
    onChanged();
  } finally {
    setBusy(false);
  }
}
