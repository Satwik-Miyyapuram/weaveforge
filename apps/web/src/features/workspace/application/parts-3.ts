import { loadCore, readyCore, typedCore } from "@/lib/rust-core";
import {
  type IWorkspaceFs,
  type JsonDiff,
  type JsonDiffEntry,
  type VaultPageBase,
  WORKSPACE_META_DIR,
  type WorkspaceProject,
} from "@weaveforge/core";
import type { ChangeSide, HeldReason, ImportDiff, ImportDiffEntry } from "@weaveforge/wasm";
import type { SkippedFile } from "./parts-2";

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
 * Mirrored files a pull removed, which the mirror must not write back.
 *
 * Kept in the root `.weaveforge` folder, which git and the folder watcher both
 * leave alone: it is this machine's record, like the database beside it.
 */
export const PULLED_DELETES_PATH = `${WORKSPACE_META_DIR}/pulled-deletes.json`;

/** The paths a pull removed and the reader has not settled yet; none when unreadable. */
export async function readPulledDeletes(fs: IWorkspaceFs): Promise<Set<string>> {
  const text = await fs.readText(PULLED_DELETES_PATH).catch(() => null);
  try {
    const parsed: unknown = text === null ? [] : JSON.parse(text);
    return new Set(Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === "string") : []);
  } catch {
    return new Set();
  }
}

/** Write the list back, sorted; an empty list removes the file. Skips a write that changes nothing. */
export async function writePulledDeletes(fs: IWorkspaceFs, paths: ReadonlySet<string>): Promise<void> {
  const before = await readPulledDeletes(fs);
  if (before.size === paths.size && [...paths].every((p) => before.has(p))) return;
  if (paths.size === 0) {
    await fs.remove(PULLED_DELETES_PATH).catch(() => undefined);
    return;
  }
  await fs.mkdirp(WORKSPACE_META_DIR);
  await fs.writeFile(PULLED_DELETES_PATH, `${JSON.stringify([...paths].sort(), null, 2)}\n`);
}

/**
 * Run a git action that can move the folder's tree, keeping this machine's
 * manifests as they were when it moved.
 *
 * Git keeps the project manifests out of history, but a folder committed by an
 * older version still carries them, and a pull brings the remote's, whose
 * digests match the files that came in. The next mirror run would then read
 * each pulled file as its own last write and put the database's older copy
 * back. With this machine's manifests restored, a pulled file differs from its
 * base: the mirror holds it back, and the folder watcher offers it for import.
 *
 * Two more things a moved tree needs:
 * - A mirrored file the pull removed is a delete made on the other machine. It
 *   goes on the pulled-deletes list, so the mirror leaves it out and the
 *   review offers the removal instead of the mirror writing it back.
 * - A project folder new to this machine has no manifest, so the mirror would
 *   overwrite its pulled files. It gets one naming every file with no digest:
 *   each file that differs from the database is held back for import.
 */
export async function keepMirrorBases<T>(
  fs: IWorkspaceFs,
  action: () => Promise<T>,
  moved: (result: T) => boolean,
): Promise<T> {
  const dirs = await topLevelDirs(fs);
  const paths = [MIRROR_MANIFEST_PATH, ...dirs.map(mirrorManifestPath)];
  const kept = new Map<string, string>();
  for (const path of paths) {
    const text = await fs.readText(path).catch(() => null);
    if (text !== null) kept.set(path, text);
  }
  const mirroredBefore = await presentMirroredPaths(fs, kept);
  const result = await action();
  if (moved(result)) {
    for (const [path, text] of kept) await fs.writeFile(path, text);
    await recordPulledDeletes(fs, mirroredBefore);
    await baseNewProjectFolders(fs, new Set(dirs), kept);
  }
  return result;
}

/** Top-level folders, without the root `.weaveforge`. */
async function topLevelDirs(fs: IWorkspaceFs): Promise<string[]> {
  const entries = await fs.list("").catch(() => []);
  return entries.filter((e) => e.kind === "dir" && e.path !== WORKSPACE_META_DIR).map((e) => e.path);
}

/** Every path the kept manifests name that is on disk now. */
async function presentMirroredPaths(fs: IWorkspaceFs, kept: ReadonlyMap<string, string>): Promise<string[]> {
  const present: string[] = [];
  for (const text of kept.values()) {
    for (const path of Object.keys(readyCore().readMirrorBase(text))) {
      if (await fs.stat(path).catch(() => null)) present.push(path);
    }
  }
  return present;
}

/** Only a file that is really missing counts; any other stat failure says nothing about the file. */
async function isMissing(fs: IWorkspaceFs, path: string): Promise<boolean> {
  try {
    return (await fs.stat(path)) === null;
  } catch (error) {
    const name = (error as { name?: unknown; code?: unknown }).name;
    const code = (error as { code?: unknown }).code;
    return name === "NotFoundError" || code === "ENOENT";
  }
}

/** Adds the mirrored files the action removed to the pulled-deletes list. */
async function recordPulledDeletes(fs: IWorkspaceFs, before: readonly string[]): Promise<void> {
  const gone: string[] = [];
  for (const path of before) {
    if (await isMissing(fs, path)) gone.push(path);
  }
  if (gone.length === 0) return;
  await writePulledDeletes(fs, new Set([...(await readPulledDeletes(fs)), ...gone]));
}

/**
 * A base for each project folder the action brought: new, or holding a
 * project `.weaveforge` folder but no manifest. A folder that was already
 * here and is no project is left alone.
 */
async function baseNewProjectFolders(
  fs: IWorkspaceFs,
  before: ReadonlySet<string>,
  kept: ReadonlyMap<string, string>,
): Promise<void> {
  for (const dir of await topLevelDirs(fs)) {
    const manifest = mirrorManifestPath(dir);
    if (kept.has(manifest)) continue;
    const isProject = await fs.stat(typedCore().projectMetaDir(dir)).catch(() => null);
    if (before.has(dir) && !isProject) continue;
    if (await fs.stat(manifest).catch(() => null)) continue;
    const files: string[] = [];
    for await (const entry of fs.walk(dir)) {
      if (entry.path !== manifest) files.push(entry.path);
    }
    if (files.length > 0) await writeMirrorManifest(fs, dir, files);
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

/** Copy one file's bytes to `to` unless something already sits there. Nothing is overwritten or removed. */
async function copyIfAbsent(fs: IWorkspaceFs, from: string, to: string): Promise<void> {
  const bytes = await fs.readFile(from).catch(() => null);
  if (bytes === null) return; // gone since the walk
  if ((await fs.readFile(to).catch(() => null)) !== null) return; // kept as it is; the source stays too
  await fs.mkdirp(to.slice(0, to.lastIndexOf("/")));
  await fs.writeFile(to, bytes);
}

/**
 * Carry a renamed project's folder over to its new `slug--id6` name, by copying.
 *
 * Without this the new name has no manifest, so the mirror writes a second full
 * copy and edits made in the old folder are never imported. The old folder is
 * kept whole: it is the only copy of the reader's files until they check the new one.
 * Returns the old folder when one was copied.
 */
export async function followProjectRename(
  fs: IWorkspaceFs,
  project: WorkspaceProject,
): Promise<string | null> {
  const core = await loadCore();
  const root = core.projectDir(project);
  if (await fs.stat(root)) return null;
  const tail = `--${typedCore().idSuffix(project.id)}`;
  const dirs = (await fs.list("")).filter((e) => e.kind === "dir").map((e) => e.path);
  // The pick is in Rust; two folders sharing the id suffix have no safe pick.
  const old = typedCore().pickRenamedFolder(dirs, tail);
  if (old === undefined) return null;
  const moved = (path: string) => core.movedPath(old, root, path);
  const newManifest = mirrorManifestPath(root);

  const files: string[] = [];
  for await (const entry of fs.walk(old)) files.push(entry.path);
  for (const path of files) {
    const to = moved(path);
    if (to === newManifest) continue; // the manifest is rekeyed below, never copied as it is
    await copyIfAbsent(fs, path, to);
  }

  // Only when the new folder has no manifest yet: an existing one is the new folder's own record.
  // An unreadable old manifest is skipped; the next run re-learns those files.
  const text = await fs.readText(mirrorManifestPath(old)).catch(() => null);
  if (text !== null && (await fs.stat(newManifest)) === null) {
    const rekeyed = core.rekeyManifestText(text, old, root);
    if (rekeyed !== undefined) await fs.writeFile(newManifest, rekeyed).catch(() => undefined);
  }
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
  // The text, the claimed-path filter and the stamp-insensitive compare live in Rust.
  // Frontmatter and a body digest only, never a body: the file sits in the user's own folder.
  const core = typedCore();
  const next = core.mirrorManifestText(paths, digests, bases, new Date().toISOString());
  const file = mirrorManifestPath(projectRoot);
  const current = await fs.readText(file).catch(() => null);
  if (current !== null && core.sameManifestIgnoringStamp(current, next)) return;
  await writeTextAtomic(fs, file, next);
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

  // Which run is due, when, and what is owed lives in Rust (`coalescerStep`). This file holds
  // only the timer handle and the run, and performs the actions each step returns.
  let state: CoalescerStateView = { suspended: false, timerArmed: false, inFlight: false, again: false };
  let timer: unknown = null;

  function dispatch(event: CoalescerEventView): void {
    const step = typedCore().coalescerStep(state, event) as CoalescerStepView;
    state = step.state;
    for (const action of step.actions) perform(action.type);
  }

  function perform(action: CoalescerActionView["type"]): void {
    if (action === "clearTimer") {
      if (timer !== null) clearTimer(timer);
      timer = null;
    } else if (action === "armTimer") {
      timer = setTimer(() => {
        timer = null;
        dispatch({ type: "timerFired" });
      }, options.debounceMs);
    } else {
      void runOnce();
    }
  }

  async function runOnce(): Promise<void> {
    try {
      await options.run();
    } catch (error) {
      options.onError?.(error);
    }
    dispatch({ type: "runSettled" });
  }

  return {
    get suspended() {
      return state.suspended;
    },
    set suspended(value: boolean) {
      dispatch({ type: "suspend", value });
    },
    request() {
      dispatch({ type: "request" });
    },
    cancel() {
      dispatch({ type: "cancel" });
    },
  };
}

interface CoalescerStateView {
  suspended: boolean;
  timerArmed: boolean;
  inFlight: boolean;
  again: boolean;
}

type CoalescerEventView =
  | { type: "request" | "cancel" | "timerFired" | "runSettled" }
  | { type: "suspend"; value: boolean };

interface CoalescerActionView {
  type: "clearTimer" | "armTimer" | "startRun";
}

interface CoalescerStepView {
  state: CoalescerStateView;
  actions: CoalescerActionView[];
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
  // A canvas is pure JSON Canvas: its id lives in the mirror's canvas-ids.json, never in the file.
  if (path.endsWith(".canvas")) return claimCanvasFile(fs, path, id, projectRoot);
  let content: string;
  try {
    content = await fs.readText(path);
  } catch {
    return false;
  }

  await loadCore();
  // Stamp-or-skip and the digest record are decided in Rust; this only does the I/O.
  const base = await readMirrorBase(fs, projectRoot);
  const plan = typedCore().planClaimImport(content, id, path, base);
  if (plan === null) return false;

  await fs.writeFile(path, plan.stamped);
  const bases = await readMirrorBases(fs, projectRoot);
  await writeMirrorManifest(fs, projectRoot, Object.keys(plan.digests), plan.digests, bases);
  return true;
}

// --- canvas-ids ---
/** The file, under the project's meta folder, that maps each canvas to its page id. */
const CANVAS_ID_MAP = "canvas-ids.json";

function canvasIdMapPath(projectRoot: string): string {
  return `${typedCore().projectMetaDir(projectRoot)}/${CANVAS_ID_MAP}`;
}

/**
 * Write text so a reader sees the old file or the new one, never half of each.
 * The canvas id map is read on every import; a torn write would hold every canvas.
 */
export async function writeTextAtomic(fs: IWorkspaceFs, path: string, text: string): Promise<void> {
  const temp = `${path}.tmp`;
  await fs.writeFile(temp, text);
  try {
    await fs.rename(temp, path);
  } catch {
    // A lock (Windows, antivirus, OneDrive) can refuse the rename: write in place, leave no temp behind.
    await fs.remove(temp).catch(() => undefined);
    await fs.writeFile(path, text);
  }
}

/**
 * The project's canvas id map by full path, or `broken` when the file is present
 * but not a JSON object. A broken map is never overwritten by a claim.
 */
export async function readCanvasIdMap(
  fs: IWorkspaceFs,
  projectRoot: string,
): Promise<{ entries: Record<string, string>; broken: boolean }> {
  const text = await fs.readText(canvasIdMapPath(projectRoot)).catch(() => null);
  if (text === null) return { entries: {}, broken: false };
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { entries: {}, broken: true };
    }
    return { entries: parsed as Record<string, string>, broken: false };
  } catch {
    return { entries: {}, broken: true };
  }
}

/**
 * Record a claimed canvas in the id map and in the manifest. The map is app-owned and
 * is rewritten on every mirror, so the claimed file becomes a mapped canvas, and the
 * manifest digest makes the mirror replace the file rather than keep a copy.
 */
async function claimCanvasFile(fs: IWorkspaceFs, path: string, id: string, projectRoot: string): Promise<boolean> {
  const prefix = `${projectRoot}/`;
  if (!path.startsWith(prefix)) return false;
  let content: string;
  try {
    content = await fs.readText(path);
  } catch {
    return false;
  }
  const map = await readCanvasIdMap(fs, projectRoot);
  if (map.broken) return false;
  const key = path.slice(prefix.length);
  const next = Object.fromEntries(Object.entries({ ...map.entries, [key]: id }).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  await writeTextAtomic(fs, canvasIdMapPath(projectRoot), `${JSON.stringify(next, null, 2)}
`);
  const bases = await readMirrorBases(fs, projectRoot);
  await writeMirrorManifest(fs, projectRoot, [path], { [path]: readyCore().digestText(content) }, bases);
  return true;
}

/**
 * Canvases in the folder with no id yet that are a canvas page the mirror has lost:
 * the file was renamed outside the app, so its content matches a mapped page whose
 * path is gone. Returns the page id for each such path.
 */
export function canvasRenameIds(
  files: Readonly<Record<string, string>>,
  projectRoot: string,
  pages: ReadonlyArray<{ id: string; kind?: string; body: string }>,
  parsed: ReadonlyArray<{ path: string; kind?: string; id?: string; body: string }>,
  map: Readonly<Record<string, string>>,
): Map<string, string> {
  const unmapped = parsed.filter((entity) => entity.kind === "canvas" && !entity.id);
  const result = new Map<string, string>();
  if (unmapped.length === 0) return result;
  const bodies = new Map(pages.filter((page) => page.kind === "canvas").map((page) => [page.id, page.body]));
  // Digest of a page whose mapped file is gone -> the ids with that body.
  const lost = new Map<string, string[]>();
  for (const [key, id] of Object.entries(map)) {
    const path = `${projectRoot}/${key}`;
    if (files[path] !== undefined) continue;
    const body = bodies.get(id);
    if (body === undefined) continue;
    const digest = readyCore().digestText(body);
    lost.set(digest, [...(lost.get(digest) ?? []), id]);
  }
  // Digest -> the unmapped canvas files with that body.
  const fresh = new Map<string, string[]>();
  for (const entity of unmapped) {
    const digest = readyCore().digestText(entity.body);
    fresh.set(digest, [...(fresh.get(digest) ?? []), entity.path]);
  }
  // Only a one-to-one match is a rename. Two lost pages, or two new files, with the
  // same body could be either way round, so neither is assigned.
  for (const [digest, paths] of fresh) {
    const ids = lost.get(digest) ?? [];
    const [path] = paths;
    const [id] = ids;
    if (paths.length === 1 && ids.length === 1 && path !== undefined && id !== undefined) result.set(path, id);
  }
  return result;
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
  /** Canvas paths matched to their page by body (`canvasRenameIds`): renamed or moved outside the app. */
  canvasRenamed?: readonly string[];
  /** Files an earlier apply refused (their id is not valid or another note holds it), each with the reason. */
  refused?: readonly SkippedFile[];
};

export type { HeldReason };

/** Held files by path, each with the first reason that holds it. */
export type HeldReasons = Readonly<Record<string, HeldReason>>;

/** Paths of renamed notes in a diff, for the apply to retitle and hand back to the mirror. */
export function renamedPaths(diff: FolderDiff): Set<string> {
  return new Set([
    ...readyCore().renamedOutsidePaths(
      diff.seen ?? {},
      diff.entries.map((entry: ImportDiffEntry) => entry.entity.path),
    ),
    ...(diff.canvasRenamed ?? []),
  ]);
}

/** Each renamed note's new path to the path it lived at before. */
export function renamedFromPaths(diff: FolderDiff): Map<string, string> {
  const from = new Map<string, string>();
  for (const [path, seen] of Object.entries(diff.seen ?? {})) {
    if (seen.renamedFrom) from.set(path, seen.renamedFrom);
  }
  return from;
}

/** The part of a folder diff safe to take in without asking, the part a person must see, and why. */
export function splitOutsideEdits(
  diff: FolderDiff,
  isOpen: (noteId: string) => boolean = () => false,
): { apply: FolderDiff; held: FolderDiff; reasons: HeldReasons } {
  const notes: ImportDiffEntry[] = diff.entries.filter(
    (entry: ImportDiffEntry) => entry.action !== "unchanged",
  );
  const rows: JsonDiffEntry[] =
    diff.json?.entries.filter((entry: JsonDiffEntry) => entry.action !== "unchanged") ?? [];

  const split = readyCore().splitOutsideEdits({
    notes: notes.map((entry: ImportDiffEntry) => {
      const id = entry.entity.id;
      return {
        action: entry.action,
        path: entry.entity.path,
        open: id ? isOpen(id) : false,
      };
    }),
    rows: rows.map((entry: JsonDiffEntry) => ({ action: entry.action, path: entry.path })),
    seen: diff.seen ?? {},
  });

  const apply = notes.filter((_: ImportDiffEntry, i: number) => !split.noteHeld[i]);
  const held = notes.filter((_: ImportDiffEntry, i: number) => split.noteHeld[i]);
  const applyOut: FolderDiff = {
    ...diff,
    entries: apply,
    counts: readyCore().countActionList(apply.map((entry: ImportDiffEntry) => entry.action)),
  };
  const heldOut: FolderDiff = {
    ...diff,
    entries: held,
    counts: readyCore().countActionList(held.map((entry: ImportDiffEntry) => entry.action)),
  };

  if (diff.json) {
    const jsonApply = rows.filter((_: JsonDiffEntry, i: number) => !split.rowHeld[i]);
    const jsonHeld = rows.filter((_: JsonDiffEntry, i: number) => split.rowHeld[i]);
    applyOut.json = {
      ...diff.json,
      entries: jsonApply,
      counts: readyCore().countActionList(jsonApply.map((entry: JsonDiffEntry) => entry.action)),
    };
    heldOut.json = {
      ...diff.json,
      entries: jsonHeld,
      counts: readyCore().countActionList(jsonHeld.map((entry: JsonDiffEntry) => entry.action)),
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
