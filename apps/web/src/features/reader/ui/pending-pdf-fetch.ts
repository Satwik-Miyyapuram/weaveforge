import { formatError } from "@/lib/format-error";

/** What fetching a publisher's PDF into the store came to, for the pane to show. */
export type PendingPdfFetch =
  | { kind: "fetched"; host: string }
  | { kind: "failed"; message: string }
  /** Another paper is open by now: the answer is not for this view (P2-166). */
  | { kind: "stale" };

/**
 * Fetch a paper's PDF into the store and say what happened. `stillOpen` is
 * checked once the download settles, so a late answer for one paper never
 * lands in the next one's view; the bytes are still kept for the paper they
 * belong to.
 */
export async function fetchPendingPdf(
  id: string,
  url: string,
  deps: { download: (id: string, url: string) => Promise<boolean>; stillOpen: () => boolean },
): Promise<PendingPdfFetch> {
  try {
    const host = new URL(url).hostname;
    const ok = await deps.download(id, url);
    if (!deps.stillOpen()) return { kind: "stale" };
    return ok ? { kind: "fetched", host } : { kind: "failed", message: `${host} did not answer with a PDF for this paper.` };
  } catch (err) {
    return deps.stillOpen() ? { kind: "failed", message: formatError(err) } : { kind: "stale" };
  }
}
