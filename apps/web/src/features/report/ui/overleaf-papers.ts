import type { Paper } from "@weaveforge/core";

import { logToApp } from "@/lib/error-report/app-log";

/**
 * The library for the Overleaf export, or none with a reason.
 *
 * The tab still renders without it — the linked projects do not need papers —
 * but an export with no papers is a bibliography with no entries, so a failed
 * read is shown rather than passed off as an empty library.
 */
export async function overleafPapers(
  listPapers: () => Promise<Paper[]>,
): Promise<{ papers: Paper[]; papersError: string | null }> {
  try {
    return { papers: await listPapers(), papersError: null };
  } catch (err) {
    logToApp({
      level: "warn",
      source: "report",
      message: "The papers for the Overleaf export could not load",
      detail: err instanceof Error ? err.message : String(err),
    });
    return {
      papers: [],
      papersError: "The papers could not load, so an export now would have no bibliography.",
    };
  }
}
