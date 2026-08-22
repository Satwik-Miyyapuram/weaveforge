import type { Paper } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";

/**
 * Delete a paper after confirming, from the card and from the note page alike.
 *
 * Both screens asked the same question, ran the same delete, and toggled the
 * same busy flag, so the wording of the warning could drift between them.
 */
export async function confirmRemovePaper(
  paper: Paper,
  setBusy: (busy: boolean) => void,
  onChanged: () => void,
): Promise<void> {
  if (!confirm(`Remove "${paper.title}"? This also deletes its list memberships and graph edges.`)) return;
  setBusy(true);
  try {
    await getContainer().papers.deletePaper(paper);
    onChanged();
  } finally {
    setBusy(false);
  }
}
