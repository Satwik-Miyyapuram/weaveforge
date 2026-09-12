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
  const cache = getReaderPdfByteCache();
  const container = getContainer();
  const snapshot = await container.workspace.snapshot();
  const papers = snapshot.papers;
  const progress: DownloadProgress = {
    done: 0,
    total: papers.length,
    fetched: 0,
    skipped: 0,
  };
  if (!cache) return progress;
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
