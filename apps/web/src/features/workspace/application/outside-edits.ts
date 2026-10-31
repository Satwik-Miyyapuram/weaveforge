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
  ImportAction,
  ImportDiff,
  ImportDiffEntry,
  JsonDiff,
  JsonDiffEntry,
} from "@weaveforge/core";

/** What the preview saw of one folder file: who moved it since the sides last agreed, and its digest then. */
export interface SeenFile {
  side: ChangeSide;
  digest: string;
  /** Neither the last agreement nor the workspace knows this path: a new file, or a copy of a known one. */
  newPath?: boolean;
}

export type FolderDiff = ImportDiff & { json?: JsonDiff; seen?: Readonly<Record<string, SeenFile>> };

/** The part of a folder diff safe to take in without asking, and the part a person must see. */
export function splitOutsideEdits(
  diff: FolderDiff,
  isOpen: (noteId: string) => boolean = () => false,
): { apply: FolderDiff; held: FolderDiff } {
  const seen = diff.seen ?? {};
  const folderAlone = (path: string) => seen[path]?.side === "folder";
  // An update from a path neither side knew is a copy carrying a known id
  // ("a copy.md", a sync conflict file): taking it in would overwrite that note.
  const takesIn = (action: ImportAction, path: string) =>
    action === "created" || (action === "updated" && !seen[path]?.newPath);

  const apply: ImportDiffEntry[] = [];
  const held: ImportDiffEntry[] = [];
  for (const entry of diff.entries) {
    if (entry.action === "unchanged") continue;
    const id = entry.entity.id;
    const safe =
      takesIn(entry.action, entry.entity.path) &&
      folderAlone(entry.entity.path) &&
      !(id && isOpen(id));
    (safe ? apply : held).push(entry);
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
    applyOut.json = { ...diff.json, entries: jsonApply, counts: countActions(jsonApply) };
    heldOut.json = { ...diff.json, entries: jsonHeld, counts: countActions(jsonHeld) };
  }

  return { apply: applyOut, held: heldOut };
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
  apply(diff: FolderDiff): Promise<unknown>;
  settle(held: FolderDiff): void;
}

/** Takes in the safe outside edits and leaves the rest for review. Returns how many of each. */
export async function applyOutsideEdits(
  deps: OutsideEditDeps,
): Promise<{ applied: number; held: number }> {
  const diff = await deps.preview();
  const { apply, held } = splitOutsideEdits(diff, (noteId) => deps.isOpen(noteId));

  const applied = apply.entries.length + (apply.json?.entries.length ?? 0);
  if (applied > 0) await deps.apply(apply);
  deps.settle(held);

  return { applied, held: held.entries.length + (held.json?.entries.length ?? 0) };
}
