/**
 * An outside edit (made in the connected folder by another program) is taken in
 * without asking only when the folder alone changed that file since the two sides
 * last agreed, and the note is not open in an editor. A JSON data file goes in
 * whole or not at all. Everything else stays for a person to review: changes made
 * on both sides (even when they merge cleanly), removals, files with no record of
 * the last agreement, and open notes.
 */
import type {
  ChangeSide,
  JsonDiff,
  JsonDiffEntry,
} from "@weaveforge/core";
import type {
  ImportAction,
  ImportDiff,
  ImportDiffEntry,
} from "@weaveforge/wasm";

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

/** Why an outside edit waits for a person, said in the review list beside the file. */
export type HeldReason =
  | "removed"
  | "edited on both sides"
  | "no record of the app's write"
  | "a copy of a known note"
  | "moved to another folder"
  | "lost its id"
  | "open in editor"
  | "a data file that cannot go in whole";

/** Held files by path, each with the first reason that holds it. */
export type HeldReasons = Readonly<Record<string, HeldReason>>;

/** The reason a note entry is held, or null when it can be taken in. */
function noteHeldReason(
  entry: ImportDiffEntry,
  seen: Readonly<Record<string, SeenFile>>,
  isOpen: (noteId: string) => boolean,
): HeldReason | null {
  const path = entry.entity.path;
  const known = seen[path];
  if (entry.action === "removed") return "removed";
  if (entry.action === "conflict") return "edited on both sides";
  // An update from a path neither side knew is a copy carrying a known id
  // ("a copy.md", a sync conflict file): taking it in would overwrite that note.
  if (entry.action === "updated" && known?.newPath) {
    if (!known.renamedFrom) return "a copy of a known note";
    // A rename keeps its folder; a move would also change the note's parent.
    if (dirOf(known.renamedFrom) !== dirOf(path)) return "moved to another folder";
  }
  // A note "created" at a known path lost its id (a tool rewrote the
  // frontmatter): taking it in would add a second copy of that note.
  if (entry.action === "created" && known && !known.newPath) return "lost its id";
  if (!known || known.side === "unknown") return "no record of the app's write";
  if (known.side !== "folder") return "edited on both sides";
  const id = entry.entity.id;
  if (id && isOpen(id)) return "open in editor";
  return null;
}

function dirOf(path: string): string {
  return path.slice(0, path.lastIndexOf("/") + 1);
}

/** Paths of renamed notes in a diff, for the apply to retitle and hand back to the mirror. */
export function renamedPaths(diff: FolderDiff): Set<string> {
  const seen = diff.seen ?? {};
  return new Set(diff.entries.map((entry) => entry.entity.path).filter((path) => seen[path]?.renamedFrom));
}

/** The part of a folder diff safe to take in without asking, the part a person must see, and why. */
export function splitOutsideEdits(
  diff: FolderDiff,
  isOpen: (noteId: string) => boolean = () => false,
): { apply: FolderDiff; held: FolderDiff; reasons: HeldReasons } {
  const seen = diff.seen ?? {};
  const folderAlone = (path: string) => seen[path]?.side === "folder";
  // A JSON row: a copy at a new path cannot update a known row (see `noteHeldReason`).
  const takesIn = (action: ImportAction, path: string) =>
    action === "created" || (action === "updated" && !seen[path]?.newPath);

  const reasons: Record<string, HeldReason> = {};
  const apply: ImportDiffEntry[] = [];
  const held: ImportDiffEntry[] = [];
  for (const entry of diff.entries) {
    if (entry.action === "unchanged") continue;
    const reason = noteHeldReason(entry, seen, isOpen);
    if (reason) reasons[entry.entity.path] ??= reason;
    (reason ? held : apply).push(entry);
  }

  const applyOut: FolderDiff = { ...diff, entries: apply, counts: countActions(apply) };
  const heldOut: FolderDiff = { ...diff, entries: held, counts: countActions(held) };

  if (diff.json) {
    const rows = diff.json.entries.filter((entry) => entry.action !== "unchanged");
    // A file is taken in whole only if every one of its rows is created or updated.
    const blocked = new Set(
      rows
        .filter((entry) => !takesIn(entry.action, entry.path))
        .map((entry) => entry.path),
    );
    const takenIn = (path: string) => folderAlone(path) && !blocked.has(path);
    const jsonApply: JsonDiffEntry[] = rows.filter((entry) => takenIn(entry.path));
    const jsonHeld: JsonDiffEntry[] = rows.filter((entry) => !takenIn(entry.path));
    for (const entry of jsonHeld)
      reasons[entry.path] ??= !folderAlone(entry.path)
        ? seen[entry.path] && seen[entry.path]?.side !== "unknown"
          ? "edited on both sides"
          : "no record of the app's write"
        : "a data file that cannot go in whole";
    applyOut.json = { ...diff.json, entries: jsonApply, counts: countActions(jsonApply) };
    heldOut.json = { ...diff.json, entries: jsonHeld, counts: countActions(jsonHeld) };
  }

  return { apply: applyOut, held: heldOut, reasons };
}

function countActions(entries: { action: ImportAction }[]): Record<ImportAction, number> {
  const counts: Record<ImportAction, number> = {
    created: 0,
    updated: 0,
    unchanged: 0,
    conflict: 0,
    removed: 0,
  };
  for (const entry of entries) counts[entry.action] += 1;
  return counts;
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
