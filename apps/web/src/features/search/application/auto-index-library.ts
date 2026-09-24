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
  if (on) void startAutoIndex(0);
  else controller?.abort();
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

/**
 * Start the background run, once per project per session.
 *
 * Called when the search index first lands; a no-op when turned off, already
 * running, or already done for this project.
 */
export async function startAutoIndex(delayMs = START_DELAY_MS): Promise<void> {
  if (!autoIndexEnabled() || status.running) return;
  const projectId = getContainer().projects.context.projectId;
  if (startedFor === projectId) return;
  startedFor = projectId;

  controller = new AbortController();
  const signal = controller.signal;
  set({ running: true, progress: null });
  try {
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    if (signal.aborted) return;

    const failures = recentFailures();
    const papers = (await papersNeedingIndex()).filter((paper) => !(paper.id in failures));
    if (papers.length === 0) return;

    const result = await indexLibraryPdfs(papers, {
      signal,
      onProgress: (progress) => set({ progress }),
    });

    const now = Date.now();
    const titles = new Map(papers.map((paper) => [paper.title, paper.id]));
    for (const title of Object.keys(result.reasons)) {
      const id = titles.get(title);
      if (id) failures[id] = now;
    }
    rememberFailures(failures);
    set({ last: result });
  } catch {
    // Background and best-effort: the button is still there, and says why.
  } finally {
    controller = null;
    set({ running: false, progress: null });
  }
}
