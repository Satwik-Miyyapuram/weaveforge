/**
 * Hides the editor until its document is seeded. Before the seed the document is
 * empty, so a keystroke typed then (or the blank shown over a note with text)
 * was not the note: the reconcile kept it as a conflict block.
 */
export function hideUntilSeeded(host: { style: { visibility: string } }): () => void {
  host.style.visibility = "hidden";
  return () => {
    host.style.visibility = "";
  };
}
