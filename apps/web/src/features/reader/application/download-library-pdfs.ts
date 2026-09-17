/**
 * Every paper's PDF into the folder (the "download at setup" of the explorer
 * plan, §8): walks the library, and for each paper whose bytes the store
 * does not hold, resolves the source the reader would and keeps what it
 * fetches. With a workspace folder open the store is the folder, so this is
 * what fills `papers/pdf/` after a fresh install — and then costs nothing on
 * the next launch, since everything is already there.
 *
 * One paper at a time with a courtesy pause between fetches, the same as
 * the search index takes: the sources are other people's servers.
 */

import { getContainer } from "@/bootstrap";

import { activeWorkspaceFs } from "@/features/workspace/application/workspace-folder";
import {
  fetchPdfBytesForCache,
  getReaderPdfByteCache,
} from "./resolve-paper-pdf-for-reader";
import { resolvePaperPdfSource } from "./resolve-paper-pdf-source";

export const DOWNLOAD_PAUSE_MS = 3_000;

export interface DownloadProgress {
  done: number;
  total: number;
  fetched: number;
  skipped: number;
}

export interface DownloadOptions {
  signal?: AbortSignal;
  onProgress?: (progress: DownloadProgress) => void;
  /** Injected for tests; defaults to the app's. */
  pauseMs?: number;
}

const pause = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    });
  });

export async function downloadLibraryPdfs(
  options: DownloadOptions = {},
): Promise<DownloadProgress> {
  const progress: DownloadProgress = {
    done: 0,
    total: 0,
    fetched: 0,
    skipped: 0,
  };
  // A folder is the whole reason this walk exists, so a session without one is
  // over before it costs anything: no container read, no cache, no network.
  // Online web mode fetches a paper's PDF when the paper is opened, and never
  // in the background — background bulk fetching is what exhausts a browser's
  // storage quota and somebody else's bandwidth for papers nobody opened.
  if (!activeWorkspaceFs()) return progress;
  const cache = getReaderPdfByteCache();
  if (!cache) return progress;
  const container = getContainer();
  const snapshot = await container.workspace.snapshot();
  const papers = snapshot.papers;
  progress.total = papers.length;
  const pauseMs = options.pauseMs ?? DOWNLOAD_PAUSE_MS;
  for (const paper of papers) {
    if (options.signal?.aborted) break;
    try {
      const held = await cache.get(paper.id);
      if (held && held.byteLength > 0) {
        progress.skipped += 1;
        continue;
      }
      // The ladder without the cache rung: what is wanted is the network.
      const resolution = await resolvePaperPdfSource({
        id: paper.id,
        url: paper.url,
        arxivId: paper.arxivId,
        doi: paper.doi,
        pdfPath: paper.pdfPath,
        metadata: paper.metadata,
      });
      if (!resolution.ok) {
        progress.skipped += 1;
        continue;
      }
      if (progress.fetched > 0) await pause(pauseMs, options.signal);
      if (options.signal?.aborted) break;
      const bytes = await fetchPdfBytesForCache(resolution.hit.url);
      if (!bytes) {
        progress.skipped += 1;
        continue;
      }
      await cache.set(paper.id, bytes);
      progress.fetched += 1;
    } catch {
      progress.skipped += 1;
    } finally {
      progress.done += 1;
      options.onProgress?.({ ...progress });
    }
  }
  return progress;
}

let started = false;

/**
 * The download once per session, in the background, after a desktop folder
 * is adopted. Idempotent: a second adoption in the same session — a folder
 * chosen over the remembered one — does not start a second walk.
 */
export function downloadLibraryPdfsOnce(): void {
  if (started) return;
  started = true;
  void downloadLibraryPdfs().catch(() => {
    // Best-effort: the reader fetches on open regardless.
  });
}

/**
 * One paper's PDF into the folder, awaited.
 *
 * The same rung of the ladder the bulk walk uses, for one paper: what the
 * store already holds is left alone, and what it does not is resolved and
 * fetched. Answers whether the folder now holds it — a paper whose source
 * cannot be resolved is a `false`, not an error, since the reader resolves it
 * again on open.
 */
export async function downloadPaperPdf(paperId: string): Promise<boolean> {
  if (!activeWorkspaceFs()) return false;
  const cache = getReaderPdfByteCache();
  if (!cache) return false;
  try {
    const held = await cache.get(paperId);
    if (held && held.byteLength > 0) return true;
    const container = getContainer();
    const paper = await container.papers.getPaper(paperId);
    if (!paper) return false;
    const resolution = await resolvePaperPdfSource({
      id: paper.id,
      url: paper.url,
      arxivId: paper.arxivId,
      doi: paper.doi,
      pdfPath: paper.pdfPath,
      metadata: paper.metadata,
    });
    if (!resolution.ok) return false;
    const bytes = await fetchPdfBytesForCache(resolution.hit.url);
    if (!bytes) return false;
    await cache.set(paper.id, bytes);
    return true;
  } catch {
    return false;
  }
}

/**
 * The same, for a caller that has a paper id and nothing to wait for.
 *
 * The bulk walk happens when a folder is adopted; a paper imported afterwards
 * — a local Zotero pull, a DOI resolved from the add form — would otherwise
 * wait for the next adoption to reach the disk. It is called from the add
 * use-case, so every path that creates a paper is covered. In a session with
 * no folder it is nothing at all, which is what keeps the web build on demand.
 */
export function queuePaperPdfDownload(paperId: string): void {
  void downloadPaperPdf(paperId).catch(() => {
    // Best-effort: the reader resolves the paper's source on open regardless.
  });
}

