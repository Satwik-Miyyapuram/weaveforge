/**
 * PDF source-resolution ladder.
 *
 * Each ladder step is an `IPdfSourceResolver`. Adding a source is a new class,
 * never an edit to the chain runner (Open/Closed). Callers supply resolvers in
 * priority order; the runner never reorders them — cost-bearing sources
 * (e.g. server blob) must be registered last by the composition root.
 */

/** Minimal paper shape the ladder needs — callers map from domain Paper. */
export interface PdfSourcePaper {
  id: string;
  doi?: string;
  arxivId?: string;
  url?: string;
  /** Caller-defined extras (Zotero key, WebDAV path, blob id, …). */
  metadata?: Record<string, unknown>;
}

export interface PdfSourceHit {
  /** How to fetch or locate the PDF bytes. */
  url: string;
  /** Optional content hash when the source already knows it (e.g. cache). */
  contentHash?: string;
}

export interface IPdfSourceResolver {
  /** Stable id, e.g. "browser-cache", "zotero", "server-blob". */
  readonly id: string;
  /** Whether this resolver can attempt the given paper. */
  supports(paper: PdfSourcePaper): boolean;
  /**
   * Attempt to locate a PDF. Return null on miss. Throwing is treated as a
   * miss by the chain runner so one broken source does not abort the ladder.
   */
  resolve(paper: PdfSourcePaper): Promise<PdfSourceHit | null>;
}

export type PdfSourceResolution =
  | { ok: true; hit: PdfSourceHit; resolverId: string }
  | { ok: false; reason: "no_source" };

/**
 * Try resolvers in the given order. Skips unsupported papers, continues past
 * failures/throws, returns the first hit with the winning resolver id.
 * Does not reorder — callers must put cost-bearing sources last.
 */
export async function resolvePdfSource(
  paper: PdfSourcePaper,
  resolvers: readonly IPdfSourceResolver[],
): Promise<PdfSourceResolution> {
  for (const resolver of resolvers) {
    if (!resolver.supports(paper)) continue;
    try {
      const hit = await resolver.resolve(paper);
      const url = hit?.url?.trim();
      if (hit && url) {
        const contentHash = hit.contentHash?.trim();
        return {
          ok: true,
          hit: contentHash ? { url, contentHash } : { url },
          resolverId: resolver.id,
        };
      }
    } catch {
      // Continue — one failing step must not abort the ladder.
    }
  }
  return { ok: false, reason: "no_source" };
}
