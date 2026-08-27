import {
  WORKSPACE_META_DIR,
  digestText,
  type IWorkspaceFs,
  type VaultPageBase,
} from "@weaveforge/core";

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
  return Object.keys(await readMirrorBase(fs)).sort();
}

/**
 * What each mirrored file said when the two sides last agreed, by path.
 *
 * The digests are the third side of the merge. Without them an import can only
 * see that two copies differ, and carrying the folder's copy over a workspace
 * edit made since the mirror wrote it is a silent loss.
 *
 * A version 1 manifest listed paths and no digests. It is still read, and
 * yields an empty base: the import then behaves as it did before, showing the
 * difference and letting the user decide.
 */
export async function readMirrorBase(fs: IWorkspaceFs): Promise<Record<string, string>> {
  try {
    const parsed = JSON.parse(await fs.readText(MIRROR_MANIFEST_PATH)) as {
      paths?: unknown;
      digests?: unknown;
    };
    const digests =
      typeof parsed.digests === "object" && parsed.digests !== null
        ? (parsed.digests as Record<string, unknown>)
        : {};
    const base: Record<string, string> = {};
    for (const path of Array.isArray(parsed.paths) ? parsed.paths : []) {
      if (typeof path !== "string") continue;
      const digest = digests[path];
      base[path] = typeof digest === "string" ? digest : "";
    }
    return base;
  } catch {
    // Absent, truncated, or written by something else. Remove nothing.
    return {};
  }
}

/**
 * What each mirrored note's frontmatter and body said when the sides agreed.
 *
 * Read apart from the digests because most callers only need to know *whether*
 * a file moved, and only the conflict path needs enough to merge it per field.
 * A manifest older than version 3 yields nothing here, and those folders keep
 * behaving as they did: a conflict is reported rather than merged.
 */
export async function readMirrorBases(fs: IWorkspaceFs): Promise<Record<string, VaultPageBase>> {
  try {
    const parsed = JSON.parse(await fs.readText(MIRROR_MANIFEST_PATH)) as { bases?: unknown };
    if (typeof parsed.bases !== "object" || parsed.bases === null) return {};
    const bases: Record<string, VaultPageBase> = {};
    for (const [path, value] of Object.entries(parsed.bases as Record<string, unknown>)) {
      const entry = value as { fields?: unknown; bodyDigest?: unknown };
      if (typeof entry?.bodyDigest !== "string") continue;
      if (typeof entry.fields !== "object" || entry.fields === null) continue;
      bases[path] = { fields: entry.fields as VaultPageBase["fields"], bodyDigest: entry.bodyDigest };
    }
    return bases;
  } catch {
    return {};
  }
}

/** The digest a file's text is recorded under. Change detection only. */
export function baseDigest(text: string): string {
  return digestText(text);
}

export async function writeMirrorManifest(
  fs: IWorkspaceFs,
  paths: readonly string[],
  digests: Readonly<Record<string, string>> = {},
  bases: Readonly<Record<string, VaultPageBase>> = {},
): Promise<void> {
  await fs.mkdirp(WORKSPACE_META_DIR);
  const kept = [...new Set(paths)].sort();
  const body = {
    version: 3,
    paths: kept,
    // Only for paths still claimed, so a manifest cannot grow forever with
    // digests of files that left the folder years ago.
    digests: Object.fromEntries(
      kept.filter((path) => digests[path] !== undefined).map((path) => [path, digests[path]]),
    ),
    // Frontmatter and a body digest, never a body. This file sits in the
    // user's own folder, and a mirror that quietly kept a second copy of every
    // note would double it for a case the fields already settle.
    bases: Object.fromEntries(
      kept.filter((path) => bases[path] !== undefined).map((path) => [path, bases[path]]),
    ),
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
