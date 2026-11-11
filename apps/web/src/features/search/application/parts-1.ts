import { getContainer } from "@/bootstrap";
import {
  pdfBytesForSource,
  resolvePaperPdfSourceForReader,
} from "@/features/reader/application/parts-3";
import { activeWorkspaceFs } from "@/features/workspace/application/workspace-folder";
import { registerSessionReset } from "@/lib/cache/parts";
import { desktop } from "@/lib/desktop/desktop-bridge";
import { readyCore, typedCore } from "@/lib/rust-core";
import { readStored, readStoredJson, writeStored, writeStoredJson } from "@/lib/safe-storage";
import {
  type AiModelRequest,
  errorMessage,
  type IModelConversation,
  type Paper,
  type SearchHit,
} from "@weaveforge/core";
import type { DocumentPageText, PaperHtmlPage, PdfIndexSource } from "@weaveforge/wasm";
import { loadPdfTexts, removePdfTexts, savePdfText } from "../infrastructure/parts-2";
import { FOLDER_CACHE_DIR } from "../infrastructure/vector-store";

// --- ask-library ---
/**
 * Ask your library: hybrid search finds the passages, the user's own model
 * answers from them alone and cites them as [n]. The passages are the user's
 * documents, so they go to the model fenced as untrusted data.
 */
export interface CitedSource {
  n: number;
  hit: SearchHit;
}

export interface AskResult {
  answer: string;
  /** The sources the answer cites, by their [n], in the order it first cites them. */
  sources: CitedSource[];
}

/** The system and user turns (prompt text and source fencing are Rust `search::ask_library`). */
export function buildAskRequest(question: string, hits: readonly SearchHit[], nonce: string): AiModelRequest {
  const { system, user } = readyCore().askPrompt(
    question,
    hits.map((hit) => ({ title: hit.title, page: hit.page ?? null, excerpt: hit.excerpt?.text ?? null })),
    nonce,
  );
  return {
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.2,
  };
}

/** The hits named by [n] or [n, m] markers, first citation order, each once. */
export function citedSources(answer: string, hits: readonly SearchHit[]): CitedSource[] {
  return readyCore()
    .citedSourceNumbers(answer, hits.length)
    .map((n) => ({ n, hit: hits[n - 1]! }));
}

export async function askLibrary(input: {
  question: string;
  search: (query: string) => Promise<readonly SearchHit[]>;
  model: IModelConversation;
  nonce?: string;
}): Promise<AskResult> {
  const hits = await input.search(input.question);
  if (hits.length === 0) return { answer: "Nothing in your library matches that question.", sources: [] };
  const { text } = await input.model.complete(buildAskRequest(input.question, hits, input.nonce ?? typedCore().contextNonce()));
  return { answer: text, sources: citedSources(text, hits) };
}

// --- pdf-text-folder ---
/**
 * A copy of the extracted PDF text in the connected workspace folder.
 *
 * IndexedDB is cleared on sign-out and lost with the app's storage; the folder
 * is the reader's own and outlives both. Without this copy the vectors in the
 * folder survived a sign-out but the next sync dropped every PDF passage,
 * because the text they were checked against was gone.
 *
 * IndexedDB stays the working copy, because the index worker reads it directly
 * and has no folder to read. This module keeps the two in step from the main
 * thread: every save and delete goes to both, and each index build first
 * restores into IndexedDB whatever only the folder still holds. One JSON file
 * per paper, written whole by the shell's atomic write.
 */

const folderDir = (projectId: string | null) => `${FOLDER_CACHE_DIR}/pdf-text/${projectId ?? "-"}`;
const folderFile = (projectId: string | null, paperId: string) =>
  `${folderDir(projectId)}/${encodeURIComponent(paperId)}.json`;

async function writeToFolder(projectId: string | null, source: PdfIndexSource): Promise<void> {
  const fs = activeWorkspaceFs();
  if (!fs) return;
  try {
    await fs.mkdirp(folderDir(projectId));
    await fs.writeFile(folderFile(projectId, source.paperId), JSON.stringify(source));
  } catch {
    /* best-effort: IndexedDB still has it */
  }
}

async function readFolder(projectId: string | null): Promise<PdfIndexSource[]> {
  const fs = activeWorkspaceFs();
  if (!fs) return [];
  let entries;
  try {
    entries = await fs.list(folderDir(projectId));
  } catch {
    return [];
  }
  const out: PdfIndexSource[] = [];
  for (const entry of entries) {
    if (entry.kind !== "file" || !entry.path.endsWith(".json")) continue;
    try {
      const parsed = JSON.parse(await fs.readText(entry.path)) as PdfIndexSource;
      if (parsed?.paperId && Array.isArray(parsed.pages)) out.push(parsed);
    } catch {
      /* one unreadable file costs one paper, not the rest */
    }
  }
  return out;
}

/** Save to IndexedDB and the folder. */
export async function savePdfTextDurably(projectId: string | null, source: PdfIndexSource): Promise<void> {
  if (source.pages.length === 0) return;
  await Promise.all([savePdfText(projectId, source), writeToFolder(projectId, source)]);
}

/** Delete from IndexedDB and the folder. */
export async function removePdfTextsDurably(projectId: string | null, paperIds: readonly string[]): Promise<void> {
  await removePdfTexts(projectId, paperIds);
  const fs = activeWorkspaceFs();
  if (!fs) return;
  for (const paperId of paperIds) {
    try {
      if (await fs.stat(folderFile(projectId, paperId))) await fs.remove(folderFile(projectId, paperId));
    } catch {
      /* already gone */
    }
  }
}

/**
 * Bring the two copies level before a build: text only the folder has goes
 * back into IndexedDB (after a sign-out or a fresh install), text only
 * IndexedDB has goes into the folder (papers read before this copy existed).
 */
export async function reconcilePdfTextFolder(projectId: string | null): Promise<void> {
  if (!activeWorkspaceFs()) return;
  const [own, folder] = await Promise.all([loadPdfTexts(projectId), readFolder(projectId)]);
  const ownIds = new Set(own.map((source) => source.paperId));
  const folderIds = new Set(folder.map((source) => source.paperId));
  for (const source of folder) if (!ownIds.has(source.paperId)) await savePdfText(projectId, source);
  for (const source of own) if (!folderIds.has(source.paperId)) await writeToFolder(projectId, source);
}

// --- index-library-pdfs ---
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
  /** Ids of the papers skipped or failed; titles can repeat, ids cannot. */
  unreadIds: string[];
}

/** Papers with a PDF that is not already indexed. */
export async function papersNeedingIndex(): Promise<Paper[]> {
  const container = getContainer();
  const snapshot = await container.workspace.snapshot();
  const { loadPdfTexts } = await import("../infrastructure/parts-2");
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
      readyCore().resolvePaperPdfUrl({ url: paper.url, arxivId: paper.arxivId }) !== null,
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
  try {
    const pages: DocumentPageText[] = [];
    for (let n = 1; n <= doc.numPages; n += 1) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      pages.push({ pageIndex: n - 1, text: pdfPageText(content.items) });
    }
    return pages;
  } finally {
    // Release the worker even when a page fails; a few hundred documents otherwise accumulate.
    await doc.destroy();
  }
}

/**
 * A page's text the way the reader builds it: a newline after each line-ending
 * run, so the last word of a line is not glued to the next (27-03). Marked
 * content items carry no text and are skipped.
 */
export function pdfPageText(items: readonly unknown[]): string {
  return readyCore().pageTextFromItems(
    items.filter(
      (item): item is { str: string; hasEOL?: boolean } =>
        typeof (item as { str?: unknown }).str === "string",
    ),
  );
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
export function readFailureReason(error: unknown, status?: number): string {
  return readyCore().readFailureReason(errorMessage(error), status);
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
  const unreadIds: string[] = [];

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
        unreadIds.push(paper.id);
        reasons[paper.title] = `no readable source (${resolution.reason ?? "unknown"})`;
        continue;
      }
      revoke = "revokeUrl" in resolution ? resolution.revokeUrl : undefined;

      // A cache hit is served from this device; anything else is somebody
      // else's server, and gets the courtesy delay before it is asked again.
      const fromCache = resolution.resolverId === "browser-cache";
      if (readyCore().courtesyPauseDue(fromCache, indexed, failed)) await pause(FETCH_DELAY_MS, options.signal);
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
      if (!bytes) throw new Error(`${readyCore().hostOf(resolution.hit.url)} did not send the file`);
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
      unreadIds.push(paper.id);
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

  return { indexed, skipped, failed, failures, reasons, unreadIds };
}

// --- auto-index-library ---
/**
 * Keeping the library's PDFs indexed without being asked each time.
 *
 * The manual "Check what is missing → Index N PDFs" stays, but a reader who
 * has turned search on expects a paper added today to be searchable tomorrow
 * without a visit to settings. So once per session, after the index is built,
 * papers whose text is not yet stored are fetched and read in the background —
 * the same polite, sequential run the button starts.
 *
 * On by default in the desktop app, where the fetch goes through the shell and
 * the text lands on this computer; off by default on the web, where it costs a
 * visitor's bandwidth they did not choose to spend.
 *
 * A paper that could not be read is not retried on every launch: a host that
 * refuses today will refuse tomorrow, and asking daily is exactly the burst the
 * courtesy delay exists to prevent. It is tried again after a week, or at once
 * from the button.
 */

const AUTO_KEY = "thesis.search.pdf-auto";
const FAILED_KEY = "thesis.search.pdf-auto-failed";
/** Let the app settle before downloading anything. */
const START_DELAY_MS = 20_000;

export interface AutoIndexStatus {
  running: boolean;
  /** Who started the run going now: the background, or the Settings button. */
  source: "auto" | "button" | null;
  progress: LibraryIndexProgress | null;
  last: LibraryIndexResult | null;
  /** The last button run was cancelled, so `last` is partial. */
  stopped: boolean;
}

/** What a run reads and calls; tests pass their own. */
export interface AutoIndexDeps {
  projectId(): string | null;
  papersNeedingIndex: typeof papersNeedingIndex;
  indexLibraryPdfs: typeof indexLibraryPdfs;
}

const defaultDeps: AutoIndexDeps = {
  projectId: () => getContainer().projects.context.projectId,
  papersNeedingIndex,
  indexLibraryPdfs,
};
let currentDeps = defaultDeps;

/** Replace what a run reads; tests only. */
export function setAutoIndexDeps(next: AutoIndexDeps): void {
  currentDeps = next;
}

let status: AutoIndexStatus = { running: false, source: null, progress: null, last: null, stopped: false };
const listeners = new Set<() => void>();
let startedFor: string | null | undefined;
let controller: AbortController | null = null;

function set(next: Partial<AutoIndexStatus>): void {
  status = { ...status, ...next };
  for (const listener of listeners) listener();
}

export function autoIndexStatus(): AutoIndexStatus {
  return status;
}

export function subscribeAutoIndex(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function autoIndexEnabled(): boolean {
  const stored = readStored(AUTO_KEY);
  if (stored !== null) return stored === "1";
  return desktop() !== null;
}

export function setAutoIndexEnabled(on: boolean): void {
  // Not persisted when storage is blocked; this session still honours it.
  writeStored(AUTO_KEY, on ? "1" : "0");
  if (on) {
    void startAutoIndex(0);
    return;
  }
  controller?.abort();
  // Turned off, so the next "on" is a fresh start, not "already done" (27-09).
  startedFor = undefined;
}

function recentFailures(): Record<string, number> {
  const parsed = readStoredJson<unknown>(FAILED_KEY, {});
  if (!parsed || typeof parsed !== "object") return {};
  const failures = parsed as Record<string, number>;
  const inWindow = new Set(readyCore().recentFailureIds(failures, Date.now()));
  return Object.fromEntries(Object.entries(failures).filter(([id]) => inWindow.has(id)));
}

/** Forgetting means one extra retry, nothing worse. */
function rememberFailures(failures: Record<string, number>): void {
  writeStoredJson(FAILED_KEY, failures);
}

/** Wait `ms`, or less if `signal` aborts first, so turning it off ends the run at once (27-10). */
function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

/**
 * Start the background run, once per project per session.
 *
 * Called when the search index first lands; a no-op when turned off, already
 * running, or already done for this project.
 */
export async function startAutoIndex(delayMs = START_DELAY_MS, deps: AutoIndexDeps = currentDeps): Promise<void> {
  if (!autoIndexEnabled() || status.running) return;
  const projectId = deps.projectId();
  if (startedFor === projectId) return;
  startedFor = projectId;

  const own = new AbortController();
  controller = own;
  const signal = own.signal;
  set({ running: true, source: "auto", progress: null });
  try {
    if (delayMs > 0) await abortableDelay(delayMs, signal);
    if (signal.aborted) return;

    const failures = recentFailures();
    const papers = (await deps.papersNeedingIndex()).filter((paper) => !(paper.id in failures));
    if (papers.length === 0) return;

    const result = await deps.indexLibraryPdfs(papers, {
      signal,
      onProgress: (progress) => set({ progress }),
    });
    // Stopped mid-run: the next user or project must not see this result.
    if (signal.aborted) return;

    const now = Date.now();
    // By id: two papers can share a title, and each failed on its own (27-11).
    for (const id of result.unreadIds) failures[id] = now;
    rememberFailures(failures);
    set({ last: result });
  } catch {
    // Background and best-effort: the button is still there, and says why.
  } finally {
    // A stopped run's cleanup must not end the run that replaced it.
    if (controller === own) {
      controller = null;
      set({ running: false, source: null, progress: null });
    }
  }
}

/**
 * The Settings button's run. Shares the status and the controller with the
 * background run, so it outlives the Settings screen, the nav chip shows it,
 * and either place can stop it. `null` when a run is already going.
 */
export async function runLibraryIndex(deps: AutoIndexDeps = currentDeps): Promise<LibraryIndexResult | null> {
  if (status.running) return null;
  const own = new AbortController();
  controller = own;
  set({ running: true, source: "button", progress: null, stopped: false });
  try {
    const papers = await deps.papersNeedingIndex();
    const result = await deps.indexLibraryPdfs(papers, {
      signal: own.signal,
      onProgress: (progress) => set({ progress }),
    });
    // A project switch replaced the controller: this result is the old project's.
    if (controller === own) set({ last: result, stopped: own.signal.aborted });
    return result;
  } finally {
    if (controller === own) {
      controller = null;
      set({ running: false, source: null, progress: null });
    }
  }
}

/**
 * Stop the run going now, keeping what it indexed. The background run is not
 * started again for this project this session: the reader asked it to stop.
 */
export function cancelLibraryIndex(): void {
  controller?.abort();
}

/**
 * Abort the run and forget it, on sign-out or a project switch: a run left
 * going reads the last project's papers into the next one's index.
 */
export function stopAutoIndex(): void {
  controller?.abort();
  controller = null;
  startedFor = undefined;
  set({ running: false, source: null, progress: null, last: null, stopped: false });
}

registerSessionReset(stopAutoIndex);
