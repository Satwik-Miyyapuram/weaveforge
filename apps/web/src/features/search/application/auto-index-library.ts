import type { Paper } from "@weaveforge/core";
import { desktop } from "@/lib/desktop/desktop-bridge";
import { getContainer } from "@/bootstrap";
import {
  indexLibraryPdfs,
  papersNeedingIndex,
  type LibraryIndexProgress,
  type LibraryIndexResult,
} from "./index-library-pdfs";

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
const RETRY_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
/** Let the app settle before downloading anything. */
const START_DELAY_MS = 20_000;

export interface AutoIndexStatus {
  running: boolean;
  progress: LibraryIndexProgress | null;
  last: LibraryIndexResult | null;
}

/** What a run needs from the app, swappable in tests. */
export interface AutoIndexDeps {
  projectId(): string | null;
  papersNeedingIndex(): Promise<Paper[]>;
  indexLibraryPdfs: typeof indexLibraryPdfs;
}

const appDeps: AutoIndexDeps = {
  projectId: () => getContainer().projects.context.projectId,
  papersNeedingIndex,
  indexLibraryPdfs,
};
let deps = appDeps;

/** Replace what a run reads; tests only. */
export function setAutoIndexDeps(next: AutoIndexDeps): void {
  deps = next;
}

let status: AutoIndexStatus = { running: false, progress: null, last: null };
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
  try {
    const stored = localStorage.getItem(AUTO_KEY);
    if (stored !== null) return stored === "1";
  } catch {
    /* fall through to the default */
  }
  return desktop() !== null;
}

export function setAutoIndexEnabled(on: boolean): void {
  try {
    localStorage.setItem(AUTO_KEY, on ? "1" : "0");
  } catch {
    /* not persisted; this session still honours it */
  }
  if (on) {
    void startAutoIndex(0);
    return;
  }
  controller?.abort();
  // Turned off, so the next "on" is a fresh start, not "already done" (27-09).
  startedFor = undefined;
}

function recentFailures(): Record<string, number> {
  try {
    const parsed = JSON.parse(localStorage.getItem(FAILED_KEY) ?? "{}") as Record<string, number>;
    const now = Date.now();
    return Object.fromEntries(Object.entries(parsed).filter(([, at]) => now - at < RETRY_AFTER_MS));
  } catch {
    return {};
  }
}

function rememberFailures(failures: Record<string, number>): void {
  try {
    localStorage.setItem(FAILED_KEY, JSON.stringify(failures));
  } catch {
    /* forgetting means one extra retry, nothing worse */
  }
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
export async function startAutoIndex(delayMs = START_DELAY_MS): Promise<void> {
  if (!autoIndexEnabled() || status.running) return;
  const projectId = deps.projectId();
  if (startedFor === projectId) return;
  startedFor = projectId;

  controller = new AbortController();
  const signal = controller.signal;
  set({ running: true, progress: null });
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

    const now = Date.now();
    // By id: two papers can share a title, and each failed on its own (27-11).
    for (const id of result.unreadIds) failures[id] = now;
    rememberFailures(failures);
    set({ last: result });
  } catch {
    // Background and best-effort: the button is still there, and says why.
  } finally {
    controller = null;
    set({ running: false, progress: null });
  }
}
