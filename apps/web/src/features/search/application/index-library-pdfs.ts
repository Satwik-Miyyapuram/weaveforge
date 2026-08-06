import type { DocumentPageText, Paper } from "@thesis/core";
import { getContainer } from "@/bootstrap";
import { resolvePaperPdfUrl } from "@/features/reader/application/sanitize-reader-url";
import { resolvePaperPdfSourceForReader } from "@/features/reader/application/resolve-paper-pdf-for-reader";
import { savePdfText } from "../infrastructure/pdf-text-store";

/**
 * Index every PDF in the library, including ones never opened.
 *
 * This is the one part of search with a real server cost: a PDF the user has
 * not read has to be fetched before it can be parsed. That is why it is an
 * explicit action with a visible count rather than something that happens on
 * its own — a library of two hundred papers is two hundred downloads, and the
 * user should be the one deciding to spend that.
 *
 * Everything else about it is local: parsing is pdf.js in the browser, and the
 * extracted text goes to IndexedDB, never to a server.
 */

export interface LibraryIndexProgress {
  done: number;
  total: number;
  /** Title currently being read, for the progress line. */
  current?: string;
  indexed: number;
  skipped: number;
  failed: number;
}

export interface LibraryIndexResult {
  indexed: number;
  skipped: number;
  failed: number;
  /** Titles that could not be read, so the user can see what was missed. */
  failures: string[];
}

/** Papers with a PDF that is not already indexed. */
export async function papersNeedingIndex(): Promise<Paper[]> {
  const container = getContainer();
  const snapshot = await container.workspace.snapshot();
  const { loadPdfTexts } = await import("../infrastructure/pdf-text-store");
  const already = new Set(
    (await loadPdfTexts(container.projects.context.projectId)).map((entry) => entry.paperId),
  );
  // Whether a paper can be read, asked of the thing that does the reading.
  // `pdfPath` looked like the right field and is not: it is reserved for a
  // storage-backed ladder that does not exist, nothing ever writes it, and
  // filtering on it meant this returned an empty list for every workspace —
  // "index the whole library" quietly did nothing at all.
  return snapshot.papers.filter(
    (paper) =>
      !already.has(paper.id) &&
      resolvePaperPdfUrl({ url: paper.url, arxivId: paper.arxivId }) !== null,
  );
}

async function extractPages(bytes: ArrayBuffer): Promise<DocumentPageText[]> {
  const lib = await import("pdfjs-dist");
  lib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  const doc = await lib.getDocument({ data: bytes }).promise;

  const pages: DocumentPageText[] = [];
  for (let n = 1; n <= doc.numPages; n += 1) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => (typeof (item as { str?: string }).str === "string" ? (item as { str: string }).str : ""))
      .join("");
    pages.push({ pageIndex: n - 1, text });
  }
  // Release the worker; a few hundred documents otherwise accumulate.
  await doc.destroy();
  return pages;
}

/**
 * Courtesy pause between fetches.
 *
 * These PDFs come from arXiv and other open-access hosts, not from us — the
 * app stores a URL and the client fetches it. A few hundred papers pulled in a
 * tight loop from one address is exactly the pattern those hosts rate-limit,
 * and arXiv asks for a delay between requests in as many words. Three seconds
 * makes a 200-paper library a fifteen-minute background job, which is the
 * honest price of not being blocked halfway through.
 *
 * Skipped when the copy is already in the local cache: no request is made, so
 * there is nobody to be polite to.
 */
const FETCH_DELAY_MS = 3_000;

const pause = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });

/**
 * Read and index the given papers, one at a time.
 *
 * Sequential on purpose: parallel downloads of large PDFs would spike memory,
 * give the progress bar nothing meaningful to report, and turn a polite
 * sequence of requests into a burst. A failure on one document is recorded and
 * skipped rather than aborting the run — one unreadable PDF should not cost
 * the other hundred.
 */
export async function indexLibraryPdfs(
  papers: readonly Paper[],
  options: {
    onProgress?(progress: LibraryIndexProgress): void;
    signal?: AbortSignal;
  } = {},
): Promise<LibraryIndexResult> {
  const container = getContainer();
  const projectId = container.projects.context.projectId;

  let indexed = 0;
  let skipped = 0;
  let failed = 0;
  const failures: string[] = [];

  const report = (done: number, current?: string) =>
    options.onProgress?.({ done, total: papers.length, current, indexed, skipped, failed });

  report(0);

  for (const [position, paper] of papers.entries()) {
    if (options.signal?.aborted) break;
    report(position, paper.title);

    let revoke: string | undefined;
    try {
      // The same source ladder the reader uses, so a cached copy is reused and
      // the resolution rules stay in one place.
      const resolution = await resolvePaperPdfSourceForReader({
        id: paper.id,
        url: paper.url,
        arxivId: paper.arxivId,
        doi: paper.doi,
        pdfPath: paper.pdfPath,
        metadata: paper.metadata,
      });
      if (!resolution.ok) {
        skipped += 1;
        continue;
      }
      revoke = "revokeUrl" in resolution ? resolution.revokeUrl : undefined;

      // A cache hit is served from this device; anything else is somebody
      // else's server, and gets the courtesy delay before it is asked again.
      const fromCache = resolution.resolverId === "browser-cache";
      if (!fromCache && indexed + failed > 0) await pause(FETCH_DELAY_MS, options.signal);
      if (options.signal?.aborted) break;

      const bytes = await (await fetch(resolution.hit.url)).arrayBuffer();
      const pages = await extractPages(bytes);
      await savePdfText(projectId, {
        paperId: paper.id,
        title: paper.title,
        pages,
        extractedAt: new Date().toISOString(),
      });
      indexed += 1;
    } catch {
      failed += 1;
      failures.push(paper.title);
    } finally {
      // Object URLs from the ladder are per-document; leaking one per paper
      // across a whole library would hold every PDF in memory.
      if (revoke) URL.revokeObjectURL(revoke);
    }
    report(position + 1, paper.title);
  }

  // The corpus changed, so the cached index is stale by construction.
  container.search.invalidate();

  return { indexed, skipped, failed, failures };
}
