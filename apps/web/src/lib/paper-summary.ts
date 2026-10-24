/**
 * The placeholder a paper carries before anyone writes its note. It is stored
 * text in existing rows, so the value must not change.
 */
export const EMPTY_PAPER_SUMMARY = "No summary yet.";

/** True when a paper's note has nothing in it but whitespace or the placeholder. */
export function isEmptyPaperSummary(summary: string | null | undefined): boolean {
  const text = summary?.trim() ?? "";
  return text === "" || text === EMPTY_PAPER_SUMMARY;
}
