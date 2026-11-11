import { loadCore, readyCore, typedCore } from "@/lib/rust-core";
import {
  type IWorkspaceFs,
  type JsonDiff,
  type VaultPageBase,
  WORKSPACE_META_DIR,
  type WorkspaceProject,
} from "@weaveforge/core";
import type { ChangeSide, HeldReason, ImportDiff, ImportDiffEntry } from "@weaveforge/wasm";

// --- mirror-manifest ---
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
  return `${typedCore().projectMetaDir(projectRoot)}/mirror.json`;
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
  // Absent, truncated, or written by something else gives {}: remove nothing.
  const text = await readManifestText(fs, projectRoot);
  return readyCore().readMirrorBase(text ?? undefined);
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
  return readyCore().jsonEditSince(base, path, text);
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
  const text = await readManifestText(fs, projectRoot);
  return readyCore().readMirrorBases(text ?? undefined);
}

/**
 * Carry a renamed project's folder over to its new `slug--id6` name.
 *
 * Without this the new name has no manifest, so the mirror writes a second full
 * copy and edits made in the old folder are never imported. Returns the old
 * folder when one was moved.
 */
export async function followProjectRename(
  fs: IWorkspaceFs,
  project: WorkspaceProject,
): Promise<string | null> {
  const core = await loadCore();
  const root = core.projectDir(project);
  if (await fs.stat(root)) return null;
  const tail = `--${typedCore().idSuffix(project.id)}`;
  const found = (await fs.list("")).filter((e) => e.kind === "dir" && e.path.endsWith(tail));
  // Two folders sharing the id suffix: no safe pick.
  if (found.length !== 1) return null;
  const old = found[0]!.path;
  const moved = (path: string) => core.movedPath(old, root, path);

  const files: string[] = [];
  for await (const entry of fs.walk(old)) files.push(entry.path);
  for (const path of files) {
    const to = moved(path);
    await fs.mkdirp(to.slice(0, to.lastIndexOf("/")));
    await fs.rename(path, to);
  }

  const manifest = mirrorManifestPath(root);
  const text = await fs.readText(manifest).catch(() => null);
  // An unreadable manifest is left as it is: the files still moved, and the next run re-learns them.
  const rekeyed = text === null ? undefined : core.rekeyManifestText(text, old, root);
  if (rekeyed !== undefined) {
    await fs.writeFile(manifest, rekeyed).catch(() => undefined);
  }
  await fs.remove(old, { recursive: true }).catch(() => undefined);
  return old;
}

export async function writeMirrorManifest(
  fs: IWorkspaceFs,
  projectRoot: string,
  paths: readonly string[],
  digests: Readonly<Record<string, string>> = {},
  bases: Readonly<Record<string, VaultPageBase>> = {},
): Promise<void> {
  await fs.mkdirp(typedCore().projectMetaDir(projectRoot));
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
  const file = mirrorManifestPath(projectRoot);
  // A new time alone is not a change; rewriting it would commit noise on every run.
  const stamp = /^\s*"writtenAt": ".*"$/m;
  const current = await fs.readText(file).catch(() => null);
  const next = `${JSON.stringify(body, null, 2)}\n`;
  if (current !== null && current.replace(stamp, "") === next.replace(stamp, "")) return;
  await fs.writeFile(file, next);
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
 * before it happened. Failures are reported, never thrown: the database is the
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

  const core = await loadCore();
  const stamped = core.stampWorkspaceId(content, id);
  if (stamped === null) return false;

  await fs.writeFile(path, stamped);
  const base = await readMirrorBase(fs, projectRoot);
  const bases = await readMirrorBases(fs, projectRoot);
  const next = core.claimDigest(base, path, stamped);
  await writeMirrorManifest(fs, projectRoot, Object.keys(next), next, bases);
  return true;
}

// --- open-notes ---
/**
 * Notes open in an editor right now, by id.
 *
 * Editors save as they type, so a note open in one can hold text not yet saved; an outside edit to it waits for
 * review instead of landing under the cursor. Counted, since one note can be open in two places.
 */
const open = new Map<string, number>();
const closedListeners = new Set<(id: string) => void>();

/** Mark these notes open until the returned function is called. Calling it twice releases once. */
export function holdOpenNotes(ids: readonly string[]): () => void {
  const unique = [...new Set(ids)];
  for (const id of unique) open.set(id, (open.get(id) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    for (const id of unique) {
      const count = (open.get(id) ?? 0) - 1;
      if (count > 0) open.set(id, count);
      else {
        open.delete(id);
        for (const listener of closedListeners) listener(id);
      }
    }
  };
}

/** Whether some editor has this note open. */
export function isNoteOpen(id: string): boolean {
  return open.has(id);
}

/** Hear when the last editor holding a note lets it go. */
export function onNoteClosed(listener: (id: string) => void): () => void {
  closedListeners.add(listener);
  return () => closedListeners.delete(listener);
}

// --- outside-edits ---
/**
 * An outside edit (made in the connected folder by another program) is taken in
 * without asking only when the folder alone changed that file since the two sides
 * last agreed, and the note is not open in an editor. A JSON data file goes in
 * whole or not at all. Everything else stays for a person to review: changes made
 * on both sides (even when they merge cleanly), removals, files with no record of
 * the last agreement, and open notes.
 *
 * The decision is in Rust (`workspace::outside_edits`); this module gathers the
 * changed entries and the app's open notes, and applies the result.
 */
/** What the preview saw of one folder file: who moved it since the sides last agreed, and its digest then. */
export interface SeenFile {
  side: ChangeSide;
  digest: string;
  /** Neither the last agreement nor the workspace knows this path: a new file, or a copy of a known one. */
  newPath?: boolean;
  /** Where the note this new path carries lived, when that file is gone: a rename, not a copy. */
  renamedFrom?: string;
}

export type FolderDiff = ImportDiff & {
  json?: JsonDiff;
  seen?: Readonly<Record<string, SeenFile>>;
  /** Each note's stored title and body digest when the preview was taken, by id (`storedDigest`). */
  stored?: Readonly<Record<string, string>>;
};

export type { HeldReason };

/** Held files by path, each with the first reason that holds it. */
export type HeldReasons = Readonly<Record<string, HeldReason>>;

/** Paths of renamed notes in a diff, for the apply to retitle and hand back to the mirror. */
export function renamedPaths(diff: FolderDiff): Set<string> {
  return new Set(
    readyCore().renamedOutsidePaths(
      diff.seen ?? {},
      diff.entries.map((entry) => entry.entity.path),
    ),
  );
}

/** The part of a folder diff safe to take in without asking, the part a person must see, and why. */
export function splitOutsideEdits(
  diff: FolderDiff,
  isOpen: (noteId: string) => boolean = () => false,
): { apply: FolderDiff; held: FolderDiff; reasons: HeldReasons } {
  const notes: ImportDiffEntry[] = diff.entries.filter((entry) => entry.action !== "unchanged");
  const rows = diff.json?.entries.filter((entry) => entry.action !== "unchanged") ?? [];

  const split = readyCore().splitOutsideEdits({
    notes: notes.map((entry) => {
      const id = entry.entity.id;
      return {
        action: entry.action,
        path: entry.entity.path,
        open: id ? isOpen(id) : false,
      };
    }),
    rows: rows.map((entry) => ({ action: entry.action, path: entry.path })),
    seen: diff.seen ?? {},
  });

  const apply = notes.filter((_, i) => !split.noteHeld[i]);
  const held = notes.filter((_, i) => split.noteHeld[i]);
  const applyOut: FolderDiff = {
    ...diff,
    entries: apply,
    counts: readyCore().countActionList(apply.map((entry) => entry.action)),
  };
  const heldOut: FolderDiff = {
    ...diff,
    entries: held,
    counts: readyCore().countActionList(held.map((entry) => entry.action)),
  };

  if (diff.json) {
    const jsonApply = rows.filter((_, i) => !split.rowHeld[i]);
    const jsonHeld = rows.filter((_, i) => split.rowHeld[i]);
    applyOut.json = {
      ...diff.json,
      entries: jsonApply,
      counts: readyCore().countActionList(jsonApply.map((entry) => entry.action)),
    };
    heldOut.json = {
      ...diff.json,
      entries: jsonHeld,
      counts: readyCore().countActionList(jsonHeld.map((entry) => entry.action)),
    };
  }

  return { apply: applyOut, held: heldOut, reasons: split.reasons };
}

/** What `applyOutsideEdits` needs from the app. */
export interface OutsideEditDeps {
  preview(): Promise<FolderDiff>;
  /** True for a note open in an editor: its edits wait for review rather than land under the cursor. */
  isOpen(noteId: string): boolean;
  /** `moved`: paths not applied because their note changed in the app after the preview. */
  apply(diff: FolderDiff): Promise<{ moved?: readonly string[] } | void>;
  settle(held: FolderDiff): void;
}

/** Takes in the safe outside edits and leaves the rest for review. Returns how many of each. */
export async function applyOutsideEdits(
  deps: OutsideEditDeps,
): Promise<{ applied: number; held: number }> {
  const diff = await deps.preview();
  const { apply, held } = splitOutsideEdits(diff, (noteId) => deps.isOpen(noteId));

  let applied = apply.entries.length + (apply.json?.entries.length ?? 0);
  if (applied > 0) applied -= (await deps.apply(apply))?.moved?.length ?? 0;
  deps.settle(held);

  return { applied, held: held.entries.length + (held.json?.entries.length ?? 0) };
}
