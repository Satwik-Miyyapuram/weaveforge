import { WORKSPACE_META_DIR, type IWorkspaceFs } from "@weaveforge/core";

/**
 * What the last sync wrote, and how the next one is paced.
 *
 * Both pieces live here rather than inside `workspace-folder.ts` because that
 * module reaches for the app container on its first line, and neither of these
 * needs one — keeping them separate is what makes them testable against an
 * in-memory filesystem alone.
 */

/**
 * Paths the last sync wrote, so departures can be detected.
 *
 * Kept in the folder rather than in memory or in local storage. The mirror
 * removes a file only when this list names it, so losing the list means stale
 * files linger — survivable — while a list belonging to a *different* folder
 * would name paths that were never written here and delete files it does not
 * own. Storing it beside the files it describes is what makes the second case
 * impossible: the folder and its manifest travel together, including to another
 * machine.
 */
export const MIRROR_MANIFEST_PATH = `${WORKSPACE_META_DIR}/mirror.json`;

export async function readMirrorManifest(fs: IWorkspaceFs): Promise<string[]> {
  try {
    const parsed = JSON.parse(await fs.readText(MIRROR_MANIFEST_PATH)) as { paths?: unknown };
    if (!Array.isArray(parsed.paths)) return [];
    return parsed.paths.filter((path): path is string => typeof path === "string");
  } catch {
    // Absent, truncated, or written by something else. Remove nothing.
    return [];
  }
}

export async function writeMirrorManifest(
  fs: IWorkspaceFs,
  paths: readonly string[],
): Promise<void> {
  await fs.mkdirp(WORKSPACE_META_DIR);
  const body = {
    version: 1,
    paths: [...new Set(paths)].sort(),
    writtenAt: new Date().toISOString(),
  };
  await fs.writeFile(MIRROR_MANIFEST_PATH, `${JSON.stringify(body, null, 2)}\n`);
}

/**
 * Carry a manifest forward across one mirror run.
 *
 * Unchanged files are still ours, so what the last sync claimed survives minus
 * what left, plus what this run wrote. A lost manifest therefore re-learns the
 * folder one write at a time rather than adopting it wholesale.
 */
export function nextManifest(
  previous: readonly string[],
  run: { written: readonly string[]; removed: readonly string[] },
): string[] {
  const removed = new Set(run.removed);
  return [...new Set([...previous.filter((path) => !removed.has(path)), ...run.written])];
}

export interface Coalescer {
  /** Run after a quiet period, restarting the clock on each call. */
  request(): void;
  /** True while a read-back is being applied, so the mirror stands down. */
  suspended: boolean;
  /** Drop a pending request; a run already in flight still finishes. */
  cancel(): void;
}

export interface CoalescerOptions {
  run(): Promise<unknown>;
  debounceMs: number;
  onError?(error: unknown): void;
  setTimeoutFn?: (fn: () => void, ms: number) => unknown;
  clearTimeoutFn?: (handle: unknown) => void;
}

/**
 * Debounce and coalesce sync requests.
 *
 * Several saves in a burst are one write-out, and a save that lands while a run
 * is in flight is re-run afterwards rather than folded into a snapshot taken
 * before it happened. Failures are reported, never thrown: Supabase is the
 * source of truth, so a lost mirror write costs a stale file while failing the
 * save that triggered it would cost the user their edit.
 */
export function createCoalescer(options: CoalescerOptions): Coalescer {
  const setTimer = options.setTimeoutFn ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = options.clearTimeoutFn ?? ((handle) => clearTimeout(handle as never));

  let timer: unknown = null;
  let inFlight: Promise<unknown> | null = null;
  let again = false;

  async function run(): Promise<void> {
    if (coalescer.suspended) return;
    if (inFlight) {
      again = true;
      return;
    }
    try {
      inFlight = options.run();
      await inFlight;
    } catch (error) {
      options.onError?.(error);
    } finally {
      inFlight = null;
    }
    if (again && !coalescer.suspended) {
      again = false;
      await run();
    }
    again = false;
  }

  const coalescer: Coalescer = {
    suspended: false,

    request() {
      if (coalescer.suspended) return;
      if (timer !== null) clearTimer(timer);
      timer = setTimer(() => {
        timer = null;
        void run();
      }, options.debounceMs);
    },

    cancel() {
      if (timer !== null) clearTimer(timer);
      timer = null;
    },
  };

  return coalescer;
}
