import {
  WORKSPACE_META_DIR,
  digestText,
  projectMetaDir,
  stampWorkspaceId,
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
/**
 * The single manifest the flat layout wrote, before projects had folders.
 *
 * Read only as a fallback, and only when a project has no manifest of its own.
 * The first run after the move has to see the paths the old layout wrote, or it
 * would leave a second copy of every file behind forever; reading it once is
 * what lets that run remove the flat originals as it writes their
 * project-scoped replacements. Never merged with a project's manifest — a path
 * claimed by both would be counted twice — and ignored entirely afterwards.
 */
export const MIRROR_MANIFEST_PATH = `${WORKSPACE_META_DIR}/mirror.json`;

/**
 * Where a project's manifest lives: `<project>/.weaveforge/mirror.json`.
 *
 * Per project, beside that project's own files. The mirror removes a file when
 * the manifest does not claim it, so one manifest shared by every project meant
 * a run for project B deleted project A's Markdown and its cached PDFs. A
 * project's manifest can only ever speak for that project.
 */
export function mirrorManifestPath(projectRoot: string): string {
  return `${projectMetaDir(projectRoot)}/mirror.json`;
}

/**
 * A project's manifest, or the flat one when the project has none yet.
 *
 * The two are never merged: the fallback exists so the *first* run after the
 * move can see the old paths, and once the run has written the project's own
 * manifest the legacy file is out of the picture for good.
 */
async function readManifestText(fs: IWorkspaceFs, projectRoot: string): Promise<string | null> {
  const own = await fs.readText(mirrorManifestPath(projectRoot)).catch(() => null);
  if (own !== null) return own;
  return fs.readText(MIRROR_MANIFEST_PATH).catch(() => null);
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
export async function readMirrorBase(
  fs: IWorkspaceFs,
  projectRoot: string,
): Promise<Record<string, string>> {
  try {
    const text = await readManifestText(fs, projectRoot);
    if (text === null) return {};
    const parsed = JSON.parse(text) as {
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
 * Whether a JSON data file on disk is something the app wrote.
 *
 * The mirror writes `relations.json` and its neighbours whenever the data
 * changes, so a report that fired on every write would report the app to itself.
 * The manifest holds the digest of what the app wrote; a file that still hashes
 * to that is its own write, and anything else — or a file with no record at all —
 * is somebody's edit.
 */
export function jsonEditSince(
  base: Readonly<Record<string, string>>,
  path: string,
  text: string,
): boolean {
  const recorded = base[path];
  return recorded === undefined || recorded !== digestText(text);
}

/**
 * What each mirrored note's frontmatter and body said when the sides agreed.
 *
 * Read apart from the digests because most callers only need to know *whether*
 * a file moved, and only the conflict path needs enough to merge it per field.
 * A manifest older than version 3 yields nothing here, and those folders keep
 * behaving as they did: a conflict is reported rather than merged.
 */
export async function readMirrorBases(
  fs: IWorkspaceFs,
  projectRoot: string,
): Promise<Record<string, VaultPageBase>> {
  try {
    const text = await readManifestText(fs, projectRoot);
    if (text === null) return {};
    const parsed = JSON.parse(text) as { bases?: unknown };
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
  projectRoot: string,
  paths: readonly string[],
  digests: Readonly<Record<string, string>> = {},
  bases: Readonly<Record<string, VaultPageBase>> = {},
): Promise<void> {
  await fs.mkdirp(projectMetaDir(projectRoot));
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
  await fs.writeFile(mirrorManifestPath(projectRoot), `${JSON.stringify(body, null, 2)}\n`);
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

/**
 * Claim a file the user wrote by hand, now that it has an entity.
 *
 * Two things happen, and both are needed. The id goes into the file, so the
 * folder and the workspace agree about what that file is from now on. The path
 * joins the manifest, so the next mirror — which writes the entity out under
 * its canonical name — removes this copy the same way it removes any file it
 * has replaced. Without the second step the folder keeps both, and the user is
 * left to work out which of two identical notes is the live one.
 *
 * Nothing is written when the file already carries an id, or has gone since the
 * preview was taken. Both are ordinary, and neither is worth failing an import
 * that has already succeeded.
 */
export async function claimImportedFile(
  fs: IWorkspaceFs,
  path: string,
  id: string,
  projectRoot: string,
): Promise<boolean> {
  let content: string;
  try {
    content = await fs.readText(path);
  } catch {
    return false;
  }

  const stamped = stampWorkspaceId(content, id);
  if (stamped === null) return false;

  await fs.writeFile(path, stamped);
  const base = await readMirrorBase(fs, projectRoot);
  const bases = await readMirrorBases(fs, projectRoot);
  base[path] = digestText(stamped);
  await writeMirrorManifest(fs, projectRoot, Object.keys(base), base, bases);
  return true;
}
