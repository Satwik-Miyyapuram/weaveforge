import type { DocumentPageText, Paper } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { resolvePaperPdfUrl } from "@/features/reader/application/sanitize-reader-url";
import {
  pdfBytesForSource,
  resolvePaperPdfSourceForReader,
} from "@/features/reader/application/resolve-paper-pdf-for-reader";
import type { PaperHtmlPage } from "@/features/reader/application/paper-html";
import { savePdfTextDurably } from "./pdf-text-folder";

/**
 * Index every PDF in the library, including ones never opened.
 *
 * This is the one part of search with a real server cost: a PDF the user has
 * not read has to be fetched before it can be parsed — a library of two hundred
 * papers is two hundred downloads. So it runs on its own only where the reader
 * has it switched on (the default in the desktop app; see
 * `auto-index-library.ts`), and otherwise from the button with a count shown.
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
  /**
   * Why each one failed, by title.
   *
   * Added because "Indexed 0, 18 could not be read" is not a diagnosis: a host
   * that refuses cross-origin reads, a 403, a 404 and a PDF that parsed to no
   * text are four different problems with four different answers, and the catch
   * block was throwing all four away. Measured on this machine, a run of 18
   * produced that exact summary and nothing else to act on.
   */
  reasons: Record<string, string>;
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

/**
 * Index a paper kept as a web page, the way a PDF's text is indexed: the
 * page's text becomes one "page" of the paper, saved beside the PDF texts and
 * added to the live index. Returns false when the page has no text.
 */
export async function indexPaperHtmlPage(page: PaperHtmlPage, title?: string): Promise<boolean> {
  const { paperHtmlText } = await import("@/features/reader/infrastructure/sanitize-paper-html");
  const text = paperHtmlText(page.html);
  if (!text) return false;
  const container = getContainer();
  const source = {
    paperId: page.paperId,
    title: title ?? page.title,
    pages: [{ pageIndex: 0, text }],
    extractedAt: new Date().toISOString(),
  };
  await savePdfTextDurably(container.projects.context.projectId, source);
  container.search.indexPdf(source);
  return true;
}

async function keptHtmlPage(paperId: string): Promise<PaperHtmlPage | null> {
  const { paperHtmlStore } = await import("@/features/reader/infrastructure/paper-html-store");
  return (await paperHtmlStore()?.get(paperId)) ?? null;
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
 * Why a paper could not be read, in words that say whether to act.
 *
 * Extracted and exported so it can be tested without a container, a network,
 * pdf.js and IndexedDB — which is why the loop that uses it had no test at all,
 * and why "Indexed 0, 18 could not be read" reached a reader with no explanation
 * attached.
 *
 * **The cross-origin branch should now be unreachable, and is kept deliberately.**
 * It fired for all 17 papers the reader reported, because the fetch was made from
 * the page; it now goes through the same-origin proxy, which is the whole point of
 * `fetchPdfBytesForCache`. It stays because a build with no proxy — a browser with
 * no server behind it — can still reach this, and a bare `TypeError: Failed to
 * fetch` identical to a dead network is worth naming when it happens.
 */
/**
 * The host of a PDF address, for a failure line.
 *
 * The whole URL was shown, and a publisher's signed link is a screenful of
 * tokens — which also expire, so the line was unreadable and useless to copy.
 */
export function hostOf(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url.length > 60 ? `${url.slice(0, 57)}…` : url;
  }
}

export function readFailureReason(error: unknown, status?: number): string {
  if (status !== undefined) return `the host answered ${status}`;
  const message = error instanceof Error ? error.message : String(error);
  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    return "the host does not allow this app to read its PDF (cross-origin)";
  }
  return message;
}

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
  const reasons: Record<string, string> = {};

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
        // No PDF, but the full text may be kept as a web page.
        const page = await keptHtmlPage(paper.id).catch(() => null);
        if (page && (await indexPaperHtmlPage(page, paper.title))) {
          indexed += 1;
          continue;
        }
        skipped += 1;
        reasons[paper.title] = `no readable source (${resolution.reason ?? "unknown"})`;
        continue;
      }
      revoke = "revokeUrl" in resolution ? resolution.revokeUrl : undefined;

      // A cache hit is served from this device; anything else is somebody
      // else's server, and gets the courtesy delay before it is asked again.
      const fromCache = resolution.resolverId === "browser-cache";
      if (!fromCache && indexed + failed > 0) await pause(FETCH_DELAY_MS, options.signal);
      if (options.signal?.aborted) break;

      const bytes = await pdfBytesForSource(resolution.hit.url);
      /*
       * Both places a resolved PDF can live, not just the remote one.
       *
       * **Two bugs, found one after the other by making the failure say what it
       * was.** First the indexer fetched the publisher directly from the page,
       * where CORS applies, so arXiv and OpenReview refused it — exactly as they
       * refuse the reader, whose own helper says "fetching the publisher directly
       * is blocked by CORS on every allowlisted host". Routing it through
       * `fetchPdfBytesForCache` fixed that and immediately exposed the second: the
       * resolver also hands back `cache://<uuid>` for a paper whose bytes are
       * **already on this device**, and `fetch` cannot read those. Thirteen of the
       * seventeen failures were that — the papers that needed no network at all.
       *
       * `pdfBytesForSource` is the single door for both shapes. The message names
       * the source, because a null here means either "not on the proxy's
       * allowlist" or "the proxy answered non-ok", and those two have different
       * answers for the reader.
       */
      if (!bytes) throw new Error(`${hostOf(resolution.hit.url)} did not send the file`);
      const pages = await extractPages(bytes);
      if (pages.length === 0) throw new Error("the PDF had no pages");
      const source = {
        paperId: paper.id,
        title: paper.title,
        pages,
        extractedAt: new Date().toISOString(),
      };
      await savePdfTextDurably(projectId, source);
      // Into the live index too, as the reader does. Saving alone left the
      // text searchable only after the next full rebuild — "Indexed 15" and
      // none of the 15 findable until a restart.
      container.search.indexPdf(source);
      indexed += 1;
    } catch (error) {
      failed += 1;
      failures.push(paper.title);
      reasons[paper.title] = readFailureReason(error);
    } finally {
      // Object URLs from the ladder are per-document; leaking one per paper
      // across a whole library would hold every PDF in memory.
      if (revoke) URL.revokeObjectURL(revoke);
    }
    // After every item, including the last — the loop used to exit without a
    // final report whenever the last paper failed, so the panel was left showing
    // the counts from before it was tried: "Indexed 0, 18 could not be read" with
    // a total of 0.
    report(position + 1, paper.title);
  }

  // The corpus changed, so the cached index is stale by construction.
  container.search.invalidate();

  return { indexed, skipped, failed, failures, reasons };
}
